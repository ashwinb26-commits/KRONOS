/**
 * Snapshot validation, shared by the browser and the server.
 *
 * The browser runs this to show the analyst what is wrong before publishing.
 * The server runs the same code again on the submitted payload and will not
 * commit anything that fails, because client-side validation proves nothing
 * about what actually arrived over the wire.
 */

import {
  HISTORICAL_FIGURE_KEYS,
  type Classification,
  type DataStatus,
  type HistoricalFigureKey,
  type HistoricalYear,
  type ModelAssumptions,
  type ValidationIssue,
  type ValuationFile,
  type ValuationSnapshot,
  type Verification,
} from './types';
import { calculateDcf, deriveOperatingNwc } from './dcf';

/** Hard ceiling on the submitted JSON body, before parsing. */
export const MAX_PAYLOAD_BYTES = 512 * 1024;

/** Largest absolute financial figure accepted, in the reporting unit. */
const MAX_FIGURE = 1e9;

const FY_PATTERN = /^FY\d{4}-\d{2}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TICKER_PATTERN = /^[A-Z0-9.&-]{1,20}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const SNAPSHOT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

const DATA_STATUSES: DataStatus[] = ['illustrative', 'in-review', 'verified'];
const CLASSIFICATIONS: Classification[] = ['reported', 'derived', 'assumption'];
const VERIFICATIONS: Verification[] = ['unverified', 'cross-checked', 'verified'];

const SNAPSHOT_KEYS = [
  'id',
  'createdAt',
  'publishedBy',
  'modelVersion',
  'publicationNotes',
  'dataStatus',
  'company',
  'sources',
  'historical',
  'assumptions',
  'scenarios',
  'sensitivity',
  'results',
  'commitSha',
] as const;

const COMPANY_KEYS = [
  'name',
  'ticker',
  'exchange',
  'sector',
  'currency',
  'units',
  'consolidationBasis',
  'fiscalYearEnd',
  'reportingPeriod',
  'valuationDate',
  'publicationDate',
  'researchNotes',
] as const;

/**
 * Remove control characters and cap length.
 *
 * This is a storage hygiene step, not an HTML escape. Research notes are
 * rendered as React text nodes and as JSON, never injected as markup, so the
 * escaping happens at render time in every consumer.
 */
export function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  /* eslint-disable-next-line no-control-regex */
  const stripped = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return stripped.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, maxLength);
}

class IssueBag {
  readonly issues: ValidationIssue[] = [];

  error(path: string, message: string) {
    this.issues.push({ path, message, severity: 'error' });
  }

  warn(path: string, message: string) {
    this.issues.push({ path, message, severity: 'warning' });
  }

  get hasErrors() {
    return this.issues.some((issue) => issue.severity === 'error');
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function checkNumber(
  bag: IssueBag,
  path: string,
  value: unknown,
  opts: { min?: number; max?: number; required?: boolean; label: string },
): number | null {
  if (value === null || value === undefined) {
    if (opts.required) bag.error(path, `${opts.label} is required.`);
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    bag.error(path, `${opts.label} must be a number.`);
    return null;
  }
  if (Math.abs(value) > MAX_FIGURE) {
    bag.error(path, `${opts.label} is larger than the model accepts. Check the units.`);
    return null;
  }
  if (opts.min !== undefined && value < opts.min) {
    bag.error(path, `${opts.label} must be ${opts.min} or more.`);
    return null;
  }
  if (opts.max !== undefined && value > opts.max) {
    bag.error(path, `${opts.label} must be ${opts.max} or less.`);
    return null;
  }
  return value;
}

function checkString(
  bag: IssueBag,
  path: string,
  value: unknown,
  opts: { max: number; label: string; required?: boolean; pattern?: RegExp; patternHint?: string },
): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    if (opts.required) bag.error(path, `${opts.label} is required.`);
    return '';
  }
  if (text.length > opts.max) {
    bag.error(path, `${opts.label} must be ${opts.max} characters or fewer.`);
    return text.slice(0, opts.max);
  }
  if (opts.pattern && !opts.pattern.test(text)) {
    bag.error(path, opts.patternHint ?? `${opts.label} is not in the expected format.`);
  }
  return text;
}

function checkUnknownKeys(bag: IssueBag, path: string, value: Record<string, unknown>, allowed: readonly string[]) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      bag.error(`${path}.${key}`, `"${key}" is not part of the snapshot schema and was rejected.`);
    }
  }
}

function validateHistoricalYear(bag: IssueBag, row: unknown, index: number, sourceIds: Set<string>) {
  const path = `historical.${index}`;
  if (!isPlainObject(row)) {
    bag.error(path, 'Each historical year must be an object.');
    return;
  }

  checkString(bag, `${path}.year`, row.year, {
    max: 12,
    label: 'Financial year',
    required: true,
    pattern: FY_PATTERN,
    patternHint: 'Write the financial year as FY2024-25.',
  });

  checkNumber(bag, `${path}.revenue`, row.revenue, {
    label: 'Revenue from operations',
    required: true,
    min: 0.0001,
  });
  checkNumber(bag, `${path}.ebit`, row.ebit, { label: 'EBIT', required: true });
  checkNumber(bag, `${path}.depreciation`, row.depreciation, {
    label: 'Depreciation and amortisation',
    required: true,
    min: 0,
  });
  checkNumber(bag, `${path}.capex`, row.capex, {
    label: 'Capital expenditure',
    required: true,
    min: 0,
  });

  const optionalNonNegative: HistoricalFigureKey[] = [
    'operatingExpenses',
    'cashAndEquivalents',
    'borrowings',
    'receivables',
    'inventories',
    'tradePayables',
    'propertyPlantEquipment',
    'leaseLiabilities',
    'nonOperatingInvestments',
  ];
  for (const key of optionalNonNegative) {
    checkNumber(bag, `${path}.${key}`, row[key], { label: key, min: 0 });
  }

  const optionalSigned: HistoricalFigureKey[] = [
    'ebitda',
    'financeCosts',
    'profitBeforeTax',
    'taxExpense',
    'netProfit',
    'otherOperatingAssets',
    'otherOperatingLiabilities',
    'nonControllingInterests',
    'operatingCashFlow',
    'changeInWorkingCapital',
    'otherInvestingItems',
    'operatingNwc',
  ];
  for (const key of optionalSigned) {
    checkNumber(bag, `${path}.${key}`, row[key], { label: key });
  }

  checkNumber(bag, `${path}.dilutedShares`, row.dilutedShares, {
    label: 'Diluted shares outstanding',
    min: 0.0001,
  });

  // Provenance
  if (row.provenance !== undefined) {
    if (!isPlainObject(row.provenance)) {
      bag.error(`${path}.provenance`, 'Provenance must be an object keyed by line item.');
    } else {
      for (const [key, entry] of Object.entries(row.provenance)) {
        const entryPath = `${path}.provenance.${key}`;
        if (!(HISTORICAL_FIGURE_KEYS as readonly string[]).includes(key)) {
          bag.error(entryPath, `"${key}" is not a recognised line item.`);
          continue;
        }
        if (!isPlainObject(entry)) {
          bag.error(entryPath, 'Each provenance entry must be an object.');
          continue;
        }
        const classification = entry.classification as Classification;
        if (!CLASSIFICATIONS.includes(classification)) {
          bag.error(
            `${entryPath}.classification`,
            'Classification must be reported, derived or assumption.',
          );
        }
        const verification = entry.verification as Verification;
        if (!VERIFICATIONS.includes(verification)) {
          bag.error(
            `${entryPath}.verification`,
            'Verification must be unverified, cross-checked or verified.',
          );
        }
        checkString(bag, `${entryPath}.page`, entry.page, { max: 24, label: 'Page reference' });
        checkString(bag, `${entryPath}.statement`, entry.statement, { max: 120, label: 'Statement' });
        checkString(bag, `${entryPath}.unit`, entry.unit, { max: 40, label: 'Unit' });
        checkString(bag, `${entryPath}.note`, entry.note, { max: 400, label: 'Note' });

        const sourceId = typeof entry.sourceId === 'string' ? entry.sourceId.trim() : '';
        if (classification === 'reported') {
          if (!sourceId) {
            bag.error(`${entryPath}.sourceId`, `${key} is marked as reported but has no source document.`);
          } else if (!sourceIds.has(sourceId)) {
            bag.error(
              `${entryPath}.sourceId`,
              `Source "${sourceId}" is referenced but is not in the source list.`,
            );
          }
          if (!String(entry.page ?? '').trim()) {
            bag.warn(`${entryPath}.page`, `${key} is reported but has no page reference yet.`);
          }
          if (verification === 'unverified') {
            bag.warn(`${entryPath}.verification`, `${key} has not been checked against the source yet.`);
          }
        } else if (sourceId && !sourceIds.has(sourceId)) {
          bag.error(
            `${entryPath}.sourceId`,
            `Source "${sourceId}" is referenced but is not in the source list.`,
          );
        }
      }
    }
  }
}

/** Cross-statement reconciliation. These are warnings, not publication blockers. */
function reconcileHistory(bag: IssueBag, history: HistoricalYear[]) {
  const tolerance = (base: number) => Math.max(1, Math.abs(base) * 0.01);

  history.forEach((row, index) => {
    const path = `historical.${index}`;

    if (row.ebitda !== null && Number.isFinite(row.ebitda)) {
      const implied = row.ebitda - row.depreciation;
      if (Math.abs(implied - row.ebit) > tolerance(row.ebit)) {
        bag.warn(
          `${path}.ebit`,
          `EBITDA less depreciation gives ${implied.toFixed(0)}, but EBIT is entered as ${row.ebit.toFixed(0)}. Reconcile the two before publishing.`,
        );
      }
    }

    if (row.operatingExpenses !== null && Number.isFinite(row.operatingExpenses)) {
      const implied = row.revenue - row.operatingExpenses - row.depreciation;
      if (Math.abs(implied - row.ebit) > tolerance(row.ebit)) {
        bag.warn(
          `${path}.operatingExpenses`,
          `Revenue less operating expenses and depreciation gives ${implied.toFixed(0)}, against EBIT of ${row.ebit.toFixed(0)}.`,
        );
      }
    }

    if (
      row.profitBeforeTax !== null &&
      Number.isFinite(row.profitBeforeTax) &&
      row.financeCosts !== null &&
      Number.isFinite(row.financeCosts)
    ) {
      const implied = row.ebit - row.financeCosts;
      if (Math.abs(implied - row.profitBeforeTax) > tolerance(row.profitBeforeTax)) {
        bag.warn(
          `${path}.profitBeforeTax`,
          `EBIT less finance costs gives ${implied.toFixed(0)}, against profit before tax of ${row.profitBeforeTax.toFixed(0)}. Other income may explain the gap, so record it in the notes.`,
        );
      }
    }

    if (
      row.profitBeforeTax !== null &&
      row.taxExpense !== null &&
      row.netProfit !== null &&
      Number.isFinite(row.profitBeforeTax) &&
      Number.isFinite(row.taxExpense) &&
      Number.isFinite(row.netProfit)
    ) {
      const implied = row.profitBeforeTax - row.taxExpense;
      if (Math.abs(implied - row.netProfit) > tolerance(row.netProfit)) {
        bag.warn(
          `${path}.netProfit`,
          `Profit before tax less tax gives ${implied.toFixed(0)}, against net profit of ${row.netProfit.toFixed(0)}.`,
        );
      }
    }

    if (row.operatingNwc === null) {
      const hasComponents =
        row.receivables !== null || row.inventories !== null || row.tradePayables !== null;
      if (!hasComponents) {
        bag.warn(
          `${path}.operatingNwc`,
          'Operating working capital is neither entered nor derivable, so it is treated as zero for this year.',
        );
      }
    }

    if (row.ebit < 0) {
      bag.warn(`${path}.ebit`, `EBIT is negative in ${row.year}. Check whether this year is comparable.`);
    }
  });

  const years = history.map((row) => row.year);
  if (new Set(years).size !== years.length) {
    bag.error('historical', 'Each financial year may only appear once.');
  }
  const sorted = [...years].sort();
  if (years.join('|') !== sorted.join('|')) {
    bag.error('historical', 'Historical years must be listed oldest first.');
  }
}

function validateAssumptions(bag: IssueBag, value: unknown): ModelAssumptions | null {
  if (!isPlainObject(value)) {
    bag.error('assumptions', 'Assumptions must be an object.');
    return null;
  }

  checkNumber(bag, 'assumptions.revenueGrowthPct', value.revenueGrowthPct, {
    label: 'Revenue growth', required: true, min: -50, max: 60,
  });
  checkNumber(bag, 'assumptions.ebitMarginPct', value.ebitMarginPct, {
    label: 'EBIT margin', required: true, min: -50, max: 80,
  });
  checkNumber(bag, 'assumptions.taxRatePct', value.taxRatePct, {
    label: 'Tax rate', required: true, min: 0, max: 60,
  });
  checkNumber(bag, 'assumptions.depreciationPctRevenue', value.depreciationPctRevenue, {
    label: 'Depreciation as a % of revenue', required: true, min: 0, max: 40,
  });
  checkNumber(bag, 'assumptions.capexPctRevenue', value.capexPctRevenue, {
    label: 'Capital expenditure driver', required: true, min: 0, max: 100,
  });
  checkNumber(bag, 'assumptions.nwcPctIncrementalRevenue', value.nwcPctIncrementalRevenue, {
    label: 'Working capital driver', required: true, min: -100, max: 100,
  });
  const wacc = checkNumber(bag, 'assumptions.waccPct', value.waccPct, {
    label: 'WACC', required: true, min: 0.01, max: 60,
  });
  const terminal = checkNumber(bag, 'assumptions.terminalGrowthPct', value.terminalGrowthPct, {
    label: 'Terminal growth', required: true, min: -10, max: 20,
  });
  checkNumber(bag, 'assumptions.netDebtCrore', value.netDebtCrore, { label: 'Net debt' });
  checkNumber(bag, 'assumptions.dilutedSharesCrore', value.dilutedSharesCrore, {
    label: 'Diluted shares', min: 0.0001,
  });

  if (value.forecastYears !== undefined) {
    const years = checkNumber(bag, 'assumptions.forecastYears', value.forecastYears, {
      label: 'Forecast period', min: 1, max: 15,
    });
    if (years !== null && !Number.isInteger(years)) {
      bag.error('assumptions.forecastYears', 'The forecast period must be a whole number of years.');
    }
  }

  if (value.firstForecastYearLabel !== undefined) {
    checkString(bag, 'assumptions.firstForecastYearLabel', value.firstForecastYearLabel, {
      max: 12,
      label: 'First forecast year',
      pattern: FY_PATTERN,
      patternHint: 'Write the first forecast year as FY2026-27.',
    });
  }

  if (value.perYear !== undefined) {
    if (!isPlainObject(value.perYear)) {
      bag.error('assumptions.perYear', 'Year by year overrides must be an object.');
    } else {
      for (const [key, series] of Object.entries(value.perYear)) {
        if (!Array.isArray(series)) {
          bag.error(`assumptions.perYear.${key}`, 'Each override must be a list of values.');
          continue;
        }
        if (series.length > 15) {
          bag.error(`assumptions.perYear.${key}`, 'Overrides cannot exceed 15 years.');
        }
        series.forEach((entry, i) => {
          if (entry === null) return;
          checkNumber(bag, `assumptions.perYear.${key}.${i}`, entry, {
            label: `${key} year ${i + 1}`, min: -100, max: 100,
          });
        });
      }
    }
  }

  if (value.wacc !== undefined) {
    if (!isPlainObject(value.wacc)) {
      bag.error('assumptions.wacc', 'The cost of capital build-up must be an object.');
    } else {
      const w = value.wacc;
      if (w.mode !== 'derived' && w.mode !== 'manual') {
        bag.error('assumptions.wacc.mode', 'Cost of capital mode must be derived or manual.');
      }
      checkNumber(bag, 'assumptions.wacc.riskFreeRatePct', w.riskFreeRatePct, {
        label: 'Risk-free rate', required: true, min: 0, max: 30,
      });
      checkNumber(bag, 'assumptions.wacc.betaLevered', w.betaLevered, {
        label: 'Beta', required: true, min: 0, max: 5,
      });
      checkNumber(bag, 'assumptions.wacc.equityRiskPremiumPct', w.equityRiskPremiumPct, {
        label: 'Equity risk premium', required: true, min: 0, max: 20,
      });
      checkNumber(bag, 'assumptions.wacc.additionalEquityPremiumPct', w.additionalEquityPremiumPct, {
        label: 'Additional equity premium', required: true, min: 0, max: 20,
      });
      checkNumber(bag, 'assumptions.wacc.costOfDebtPreTaxPct', w.costOfDebtPreTaxPct, {
        label: 'Pre-tax cost of debt', required: true, min: 0, max: 30,
      });
      checkNumber(bag, 'assumptions.wacc.marginalTaxRatePct', w.marginalTaxRatePct, {
        label: 'Marginal tax rate', required: true, min: 0, max: 60,
      });
      const eq = checkNumber(bag, 'assumptions.wacc.equityWeightPct', w.equityWeightPct, {
        label: 'Equity weight', required: true, min: 0, max: 100,
      });
      const dt = checkNumber(bag, 'assumptions.wacc.debtWeightPct', w.debtWeightPct, {
        label: 'Debt weight', required: true, min: 0, max: 100,
      });
      checkNumber(bag, 'assumptions.wacc.manualWaccPct', w.manualWaccPct, {
        label: 'Manual WACC', required: true, min: 0.01, max: 60,
      });
      if (w.mode === 'derived' && eq !== null && dt !== null && Math.abs(eq + dt - 100) > 0.01) {
        bag.error(
          'assumptions.wacc.equityWeightPct',
          `Equity and debt weights add up to ${(eq + dt).toFixed(2)}%. They must total 100%.`,
        );
      }
    }
  }

  if (value.bridge !== undefined) {
    if (!isPlainObject(value.bridge)) {
      bag.error('assumptions.bridge', 'The equity bridge must be an object.');
    } else {
      const b = value.bridge;
      for (const key of ['grossDebt', 'leaseLiabilities', 'cashAndEquivalents', 'nonOperatingInvestments'] as const) {
        checkNumber(bag, `assumptions.bridge.${key}`, b[key], { label: key, required: true, min: 0 });
      }
      for (const key of ['nonControllingInterests', 'otherClaims'] as const) {
        checkNumber(bag, `assumptions.bridge.${key}`, b[key], { label: key, required: true });
      }
      checkNumber(bag, 'assumptions.bridge.dilutedShares', b.dilutedShares, {
        label: 'Diluted shares', required: true, min: 0.0001,
      });
      if (typeof b.leasesIncludedInGrossDebt !== 'boolean') {
        bag.error(
          'assumptions.bridge.leasesIncludedInGrossDebt',
          'State whether lease liabilities are already inside gross debt.',
        );
      }
      if (b.leaseTreatment !== 'capitalised' && b.leaseTreatment !== 'expensed') {
        bag.error('assumptions.bridge.leaseTreatment', 'Lease treatment must be capitalised or expensed.');
      }
    }
  }

  if (wacc !== null && terminal !== null && terminal >= wacc) {
    bag.error(
      'assumptions.terminalGrowthPct',
      `Terminal growth of ${terminal}% is at or above the discount rate of ${wacc}%, which gives an infinite value. Lower terminal growth or raise WACC.`,
    );
  }

  return bag.hasErrors ? null : (value as unknown as ModelAssumptions);
}

function validateScenarios(bag: IssueBag, value: unknown) {
  if (!isPlainObject(value)) {
    bag.error('scenarios', 'Scenarios must be an object with bull, base and bear entries.');
    return;
  }
  const required = ['bull', 'base', 'bear'];
  for (const key of Object.keys(value)) {
    if (!required.includes(key)) {
      bag.error(`scenarios.${key}`, `"${key}" is not a recognised scenario.`);
    }
  }
  for (const key of required) {
    const entry = value[key];
    if (!isPlainObject(entry)) {
      bag.error(`scenarios.${key}`, `The ${key} scenario is missing.`);
      continue;
    }
    checkString(bag, `scenarios.${key}.label`, entry.label, { max: 60, label: 'Scenario name', required: true });
    checkString(bag, `scenarios.${key}.notes`, entry.notes, { max: 600, label: 'Scenario notes' });
    if (!isPlainObject(entry.overrides)) {
      bag.error(`scenarios.${key}.overrides`, 'Scenario overrides must be an object.');
      continue;
    }
    const allowed = [
      'revenueGrowthPct', 'ebitMarginPct', 'taxRatePct', 'depreciationPctRevenue',
      'capexPctRevenue', 'nwcPctIncrementalRevenue', 'waccPct', 'terminalGrowthPct',
    ];
    for (const [overrideKey, overrideValue] of Object.entries(entry.overrides)) {
      if (!allowed.includes(overrideKey)) {
        bag.error(`scenarios.${key}.overrides.${overrideKey}`, `"${overrideKey}" cannot be overridden by a scenario.`);
        continue;
      }
      checkNumber(bag, `scenarios.${key}.overrides.${overrideKey}`, overrideValue, {
        label: overrideKey, min: -100, max: 100,
      });
    }
  }
}

function validateSensitivity(bag: IssueBag, value: unknown) {
  if (!isPlainObject(value)) {
    bag.error('sensitivity', 'The sensitivity grid must be an object.');
    return;
  }
  for (const key of ['waccPct', 'terminalGrowthPct'] as const) {
    const axis = value[key];
    if (!Array.isArray(axis)) {
      bag.error(`sensitivity.${key}`, 'Each sensitivity axis must be a list of numbers.');
      continue;
    }
    if (axis.length < 2 || axis.length > 9) {
      bag.error(`sensitivity.${key}`, 'Each sensitivity axis needs between 2 and 9 values.');
    }
    axis.forEach((entry, i) => {
      checkNumber(bag, `sensitivity.${key}.${i}`, entry, { label: 'Sensitivity value', required: true, min: -20, max: 60 });
    });
    const ascending = axis.every((entry, i) => i === 0 || Number(entry) > Number(axis[i - 1]));
    if (!ascending) {
      bag.error(`sensitivity.${key}`, 'Sensitivity values must be unique and listed low to high.');
    }
  }
}

export interface SnapshotValidation {
  issues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  ok: boolean;
}

/**
 * Validate one snapshot submitted for publication.
 *
 * Errors block publication. Warnings are shown and require the analyst to
 * confirm, because a reconciliation gap is sometimes the right answer.
 */
export function validateSnapshot(input: unknown): SnapshotValidation {
  const bag = new IssueBag();

  if (!isPlainObject(input)) {
    bag.error('', 'The submitted snapshot is not an object.');
    return summarise(bag);
  }

  checkUnknownKeys(bag, 'snapshot', input, SNAPSHOT_KEYS);

  checkString(bag, 'id', input.id, {
    max: 64, label: 'Snapshot id', required: true, pattern: SNAPSHOT_ID_PATTERN,
    patternHint: 'The snapshot id may use lowercase letters, numbers and hyphens only.',
  });
  checkString(bag, 'modelVersion', input.modelVersion, {
    max: 16, label: 'Model version', required: true, pattern: VERSION_PATTERN,
    patternHint: 'Write the model version as 1.0.0.',
  });
  checkString(bag, 'publicationNotes', input.publicationNotes, { max: 1200, label: 'Publication notes' });

  const dataStatus = input.dataStatus as DataStatus;
  if (!DATA_STATUSES.includes(dataStatus)) {
    bag.error('dataStatus', 'Data status must be illustrative, in-review or verified.');
  }

  // Company
  if (!isPlainObject(input.company)) {
    bag.error('company', 'Company details are missing.');
  } else {
    const c = input.company;
    checkUnknownKeys(bag, 'company', c, COMPANY_KEYS);
    checkString(bag, 'company.name', c.name, { max: 120, label: 'Company name', required: true });
    checkString(bag, 'company.ticker', c.ticker, {
      max: 20, label: 'Ticker', required: true, pattern: TICKER_PATTERN,
      patternHint: 'Tickers may use capital letters, numbers, dots, ampersands and hyphens.',
    });
    checkString(bag, 'company.exchange', c.exchange, { max: 40, label: 'Exchange', required: true });
    checkString(bag, 'company.sector', c.sector, { max: 80, label: 'Sector', required: true });
    checkString(bag, 'company.currency', c.currency, {
      max: 3, label: 'Currency', required: true, pattern: /^[A-Z]{3}$/,
      patternHint: 'Use a 3 letter currency code such as INR.',
    });
    checkString(bag, 'company.units', c.units, { max: 60, label: 'Reporting unit', required: true });
    if (c.consolidationBasis !== 'Consolidated' && c.consolidationBasis !== 'Standalone') {
      bag.error('company.consolidationBasis', 'Consolidation basis must be Consolidated or Standalone.');
    }
    checkString(bag, 'company.fiscalYearEnd', c.fiscalYearEnd, { max: 20, label: 'Financial year end', required: true });
    checkString(bag, 'company.reportingPeriod', c.reportingPeriod, {
      max: 12, label: 'Latest reported period', required: true, pattern: FY_PATTERN,
      patternHint: 'Write the latest reported period as FY2024-25.',
    });
    for (const key of ['valuationDate', 'publicationDate'] as const) {
      checkString(bag, `company.${key}`, c[key], {
        max: 10, label: key === 'valuationDate' ? 'Valuation date' : 'Publication date',
        required: true, pattern: ISO_DATE_PATTERN, patternHint: 'Use the date format 2026-04-30.',
      });
    }
    checkString(bag, 'company.researchNotes', c.researchNotes, { max: 4000, label: 'Research notes' });
  }

  // Sources
  const sourceIds = new Set<string>();
  if (!Array.isArray(input.sources)) {
    bag.error('sources', 'The source list is missing.');
  } else {
    if (input.sources.length > 40) {
      bag.error('sources', 'A snapshot may reference at most 40 source documents.');
    }
    input.sources.forEach((source, index) => {
      const path = `sources.${index}`;
      if (!isPlainObject(source)) {
        bag.error(path, 'Each source must be an object.');
        return;
      }
      const id = checkString(bag, `${path}.id`, source.id, {
        max: 64, label: 'Source id', required: true, pattern: SLUG_PATTERN,
        patternHint: 'Source ids may use lowercase letters, numbers and hyphens only.',
      });
      if (id) {
        if (sourceIds.has(id)) bag.error(`${path}.id`, `Source id "${id}" is used more than once.`);
        sourceIds.add(id);
      }
      checkString(bag, `${path}.label`, source.label, { max: 160, label: 'Source title', required: true });
      const url = checkString(bag, `${path}.url`, source.url, { max: 500, label: 'Source link', required: true });
      if (url && !/^https?:\/\/[^\s]+$/i.test(url)) {
        bag.error(`${path}.url`, 'Source links must start with http:// or https://.');
      }
      checkString(bag, `${path}.reportYear`, source.reportYear, {
        max: 12, label: 'Report year', required: true, pattern: FY_PATTERN,
        patternHint: 'Write the report year as FY2024-25.',
      });
      checkString(bag, `${path}.retrievedOn`, source.retrievedOn, {
        max: 10, label: 'Date retrieved', required: true, pattern: ISO_DATE_PATTERN,
        patternHint: 'Use the date format 2026-04-30.',
      });
      checkString(bag, `${path}.notes`, source.notes, { max: 400, label: 'Source notes' });
    });
  }

  // Historical
  if (!Array.isArray(input.historical)) {
    bag.error('historical', 'Historical financial data is missing.');
  } else {
    if (input.historical.length < 1) {
      bag.error('historical', 'At least one historical year is required.');
    }
    if (input.historical.length > 15) {
      bag.error('historical', 'A snapshot may hold at most 15 historical years.');
    }
    input.historical.forEach((row, index) => validateHistoricalYear(bag, row, index, sourceIds));
  }

  const assumptions = validateAssumptions(bag, input.assumptions);
  validateScenarios(bag, input.scenarios);
  validateSensitivity(bag, input.sensitivity);

  // Model must actually run.
  if (!bag.hasErrors && assumptions && Array.isArray(input.historical)) {
    const history = input.historical as HistoricalYear[];
    reconcileHistory(bag, history);
    try {
      const result = calculateDcf(history, assumptions);
      for (const warning of result.warnings) bag.warn('assumptions', warning);

      const bridge = assumptions.bridge;
      const latest = history[history.length - 1];
      if (bridge && latest) {
        const compare = (
          label: string,
          path: string,
          bridgeValue: number,
          reported: number | null,
        ) => {
          if (reported === null || !Number.isFinite(reported)) return;
          if (Math.abs(bridgeValue - reported) > Math.max(1, Math.abs(reported) * 0.02)) {
            bag.warn(
              path,
              `${label} in the bridge is ${bridgeValue.toFixed(0)}, against ${reported.toFixed(0)} in ${latest.year}. Explain the difference in the notes or align the two.`,
            );
          }
        };
        compare('Cash', 'assumptions.bridge.cashAndEquivalents', bridge.cashAndEquivalents, latest.cashAndEquivalents);
        compare('Gross debt', 'assumptions.bridge.grossDebt', bridge.grossDebt, latest.borrowings);
        compare('Diluted shares', 'assumptions.bridge.dilutedShares', bridge.dilutedShares, latest.dilutedShares);
        compare('Non-controlling interests', 'assumptions.bridge.nonControllingInterests', bridge.nonControllingInterests, latest.nonControllingInterests);
      }

      if (dataStatus === 'verified') {
        let unverified = 0;
        for (const row of history) {
          for (const [key, entry] of Object.entries(row.provenance ?? {})) {
            if (entry.classification === 'reported' && entry.verification !== 'verified') {
              unverified += 1;
              bag.error(
                `historical.${history.indexOf(row)}.provenance.${key}.verification`,
                `${key} in ${row.year} is not verified, so this snapshot cannot be published as verified research.`,
              );
            }
          }
        }
        if (unverified === 0 && history.every((row) => Object.keys(row.provenance ?? {}).length === 0)) {
          bag.error(
            'dataStatus',
            'This snapshot is marked verified but carries no source trail. Record the source and page for each reported figure first.',
          );
        }
      }

      if (dataStatus === 'illustrative') {
        bag.warn(
          'dataStatus',
          'This snapshot is marked illustrative, so the public dashboard will show the placeholder-data banner.',
        );
      }

      const totalNwc = history.reduce((sum, row) => sum + deriveOperatingNwc(row), 0);
      if (totalNwc === 0) {
        bag.warn(
          'historical',
          'Operating working capital is zero across every year, so the change in working capital drops out of free cash flow.',
        );
      }
    } catch (error) {
      bag.error(
        'assumptions',
        error instanceof Error ? error.message : 'The model could not be calculated with these assumptions.',
      );
    }
  }

  return summarise(bag);
}

function summarise(bag: IssueBag): SnapshotValidation {
  const errors = bag.issues.filter((issue) => issue.severity === 'error');
  const warnings = bag.issues.filter((issue) => issue.severity === 'warning');
  return { issues: bag.issues, errors, warnings, ok: errors.length === 0 };
}

/**
 * Shape check for the stored data file, used when the server reads the
 * repository copy before appending to it.
 */
export function isValuationFile(value: unknown): value is ValuationFile {
  if (!isPlainObject(value)) return false;
  if (typeof value.schemaVersion !== 'number') return false;
  if (typeof value.current !== 'string') return false;
  if (!Array.isArray(value.snapshots)) return false;
  return value.snapshots.every(
    (snapshot) => isPlainObject(snapshot) && typeof snapshot.id === 'string',
  );
}

/** Normalise free-text fields on a snapshot before it is written to the repository. */
export function sanitizeSnapshot(snapshot: ValuationSnapshot): ValuationSnapshot {
  return {
    ...snapshot,
    publicationNotes: sanitizeText(snapshot.publicationNotes, 1200),
    company: {
      ...snapshot.company,
      name: sanitizeText(snapshot.company.name, 120),
      sector: sanitizeText(snapshot.company.sector, 80),
      exchange: sanitizeText(snapshot.company.exchange, 40),
      units: sanitizeText(snapshot.company.units, 60),
      fiscalYearEnd: sanitizeText(snapshot.company.fiscalYearEnd, 20),
      researchNotes: sanitizeText(snapshot.company.researchNotes, 4000),
    },
    sources: snapshot.sources.map((source) => ({
      ...source,
      label: sanitizeText(source.label, 160),
      notes: source.notes ? sanitizeText(source.notes, 400) : undefined,
    })),
    historical: snapshot.historical.map((row) => ({
      ...row,
      provenance: Object.fromEntries(
        Object.entries(row.provenance ?? {}).map(([key, entry]) => [
          key,
          {
            ...entry,
            statement: sanitizeText(entry.statement, 120),
            page: sanitizeText(entry.page, 24),
            unit: sanitizeText(entry.unit, 40),
            note: entry.note ? sanitizeText(entry.note, 400) : undefined,
          },
        ]),
      ),
    })),
    scenarios: {
      bull: { ...snapshot.scenarios.bull, label: sanitizeText(snapshot.scenarios.bull.label, 60), notes: sanitizeText(snapshot.scenarios.bull.notes, 600) },
      base: { ...snapshot.scenarios.base, label: sanitizeText(snapshot.scenarios.base.label, 60), notes: sanitizeText(snapshot.scenarios.base.notes, 600) },
      bear: { ...snapshot.scenarios.bear, label: sanitizeText(snapshot.scenarios.bear.label, 60), notes: sanitizeText(snapshot.scenarios.bear.notes, 600) },
    },
  };
}
