/**
 * Snapshot bookkeeping: identifiers, append-only merging, and the diff the
 * admin studio shows before anything is committed.
 *
 * The merge rules exist so a six-month release never destroys an earlier one:
 * publishing appends a new dated snapshot and moves the `current` pointer.
 * Nothing already published is edited or removed.
 */

import type {
  HistoricalFigureKey,
  HistoricalYear,
  ValuationFile,
  ValuationSnapshot,
} from './types';
import { HISTORICAL_FIGURE_KEYS } from './types';

export const SCHEMA_VERSION = 2;

/** Largest number of snapshots a single data file will hold. */
export const MAX_SNAPSHOTS = 40;

export class SnapshotMergeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SnapshotMergeError';
    this.code = code;
  }
}

/**
 * Build a snapshot id from the valuation date, adding a counter when more than
 * one release is published against the same date.
 */
export function createSnapshotId(valuationDate: string, existingIds: Iterable<string>): string {
  const taken = new Set(existingIds);
  const base = `snap-${valuationDate}`;
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new SnapshotMergeError(
    'snapshot_id',
    'There are already too many snapshots for this valuation date. Change the valuation date.',
  );
}

export function emptyValuationFile(): ValuationFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    current: '',
    snapshots: [],
  };
}

/**
 * Append a snapshot and point `current` at it.
 *
 * Throws rather than overwriting when the id is already present, so a stale
 * admin tab cannot quietly replace a release someone already published.
 */
export function appendSnapshot(file: ValuationFile, snapshot: ValuationSnapshot): ValuationFile {
  if (file.snapshots.some((existing) => existing.id === snapshot.id)) {
    throw new SnapshotMergeError(
      'duplicate_snapshot',
      `A snapshot with the id "${snapshot.id}" is already published. Reload the studio so it can pick a fresh id.`,
    );
  }
  if (file.snapshots.length >= MAX_SNAPSHOTS) {
    throw new SnapshotMergeError(
      'snapshot_limit',
      `This data file already holds ${MAX_SNAPSHOTS} snapshots. Archive the oldest releases before publishing another.`,
    );
  }

  const snapshots = [...file.snapshots, snapshot].sort((a, b) =>
    a.company.valuationDate === b.company.valuationDate
      ? a.createdAt.localeCompare(b.createdAt)
      : a.company.valuationDate.localeCompare(b.company.valuationDate),
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    current: snapshot.id,
    snapshots,
  };
}

export function findSnapshot(file: ValuationFile, id: string): ValuationSnapshot | null {
  return file.snapshots.find((snapshot) => snapshot.id === id) ?? null;
}

export function currentSnapshot(file: ValuationFile): ValuationSnapshot | null {
  return findSnapshot(file, file.current) ?? file.snapshots[file.snapshots.length - 1] ?? null;
}

/** Snapshots newest first, for the public history selector. */
export function snapshotsNewestFirst(file: ValuationFile): ValuationSnapshot[] {
  return [...file.snapshots].sort((a, b) =>
    b.company.valuationDate.localeCompare(a.company.valuationDate) ||
    b.createdAt.localeCompare(a.createdAt),
  );
}

export interface FieldChange {
  path: string;
  label: string;
  before: string;
  after: string;
  kind: 'added' | 'removed' | 'changed';
}

const FIGURE_LABELS: Record<HistoricalFigureKey, string> = {
  revenue: 'Revenue from operations',
  operatingExpenses: 'Operating expenses',
  ebitda: 'EBITDA',
  depreciation: 'Depreciation and amortisation',
  ebit: 'EBIT',
  financeCosts: 'Finance costs',
  profitBeforeTax: 'Profit before tax',
  taxExpense: 'Tax expense',
  netProfit: 'Net profit',
  cashAndEquivalents: 'Cash and cash equivalents',
  borrowings: 'Borrowings',
  receivables: 'Trade receivables',
  inventories: 'Inventories',
  tradePayables: 'Trade payables',
  propertyPlantEquipment: 'Property, plant and equipment',
  otherOperatingAssets: 'Other operating assets',
  otherOperatingLiabilities: 'Other operating liabilities',
  leaseLiabilities: 'Lease liabilities',
  nonControllingInterests: 'Non-controlling interests',
  nonOperatingInvestments: 'Non-operating investments',
  operatingCashFlow: 'Operating cash flow',
  capex: 'Capital expenditure',
  changeInWorkingCapital: 'Change in working capital',
  otherInvestingItems: 'Other investing items',
  dilutedShares: 'Diluted shares outstanding',
  operatingNwc: 'Operating net working capital',
};

export const HISTORICAL_FIGURE_LABELS = FIGURE_LABELS;

const ASSUMPTION_LABELS: Record<string, string> = {
  revenueGrowthPct: 'Revenue growth',
  ebitMarginPct: 'EBIT margin',
  taxRatePct: 'Operating tax rate',
  depreciationPctRevenue: 'Depreciation as a % of revenue',
  capexPctRevenue: 'Capital expenditure driver',
  nwcPctIncrementalRevenue: 'Working capital driver',
  waccPct: 'Weighted average cost of capital',
  terminalGrowthPct: 'Terminal growth',
  forecastYears: 'Forecast period',
  firstForecastYearLabel: 'First forecast year',
  capexMethod: 'Capital expenditure method',
  nwcMethod: 'Working capital method',
  midYearConvention: 'Mid-year discounting',
  'wacc.mode': 'Cost of capital mode',
  'wacc.riskFreeRatePct': 'Risk-free rate',
  'wacc.betaLevered': 'Levered beta',
  'wacc.equityRiskPremiumPct': 'Equity risk premium',
  'wacc.additionalEquityPremiumPct': 'Additional equity premium',
  'wacc.costOfDebtPreTaxPct': 'Pre-tax cost of debt',
  'wacc.marginalTaxRatePct': 'Marginal tax rate',
  'wacc.equityWeightPct': 'Equity weight',
  'wacc.debtWeightPct': 'Debt weight',
  'wacc.manualWaccPct': 'Manual WACC',
  'bridge.grossDebt': 'Gross debt',
  'bridge.leaseLiabilities': 'Lease liabilities',
  'bridge.leasesIncludedInGrossDebt': 'Leases already inside gross debt',
  'bridge.leaseTreatment': 'Lease treatment',
  'bridge.cashAndEquivalents': 'Cash and equivalents',
  'bridge.nonOperatingInvestments': 'Non-operating investments',
  'bridge.nonControllingInterests': 'Non-controlling interests',
  'bridge.otherClaims': 'Other debt-like claims',
  'bridge.dilutedShares': 'Diluted shares outstanding',
};

const COMPANY_LABELS: Record<string, string> = {
  name: 'Company name',
  ticker: 'Ticker',
  exchange: 'Exchange',
  sector: 'Sector',
  currency: 'Currency',
  units: 'Reporting unit',
  consolidationBasis: 'Consolidation basis',
  fiscalYearEnd: 'Financial year end',
  reportingPeriod: 'Latest reported period',
  valuationDate: 'Valuation date',
  publicationDate: 'Publication date',
  researchNotes: 'Research notes',
};

const show = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return 'not set';
  if (typeof value === 'number') return String(Math.round(value * 10000) / 10000);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
};

function compareScalar(
  changes: FieldChange[],
  path: string,
  label: string,
  before: unknown,
  after: unknown,
) {
  const a = show(before);
  const b = show(after);
  if (a === b) return;
  changes.push({
    path,
    label,
    before: a,
    after: b,
    kind: a === 'not set' ? 'added' : b === 'not set' ? 'removed' : 'changed',
  });
}

/**
 * Every difference between the published snapshot and the one about to be
 * published, grouped by area so the preview can show them in sections.
 */
export function diffSnapshots(
  previous: ValuationSnapshot | null,
  next: ValuationSnapshot,
): { company: FieldChange[]; historical: FieldChange[]; assumptions: FieldChange[]; sources: FieldChange[]; meta: FieldChange[] } {
  const company: FieldChange[] = [];
  const historical: FieldChange[] = [];
  const assumptions: FieldChange[] = [];
  const sources: FieldChange[] = [];
  const meta: FieldChange[] = [];

  if (!previous) {
    meta.push({
      path: 'snapshot',
      label: 'First published snapshot',
      before: 'nothing published',
      after: next.id,
      kind: 'added',
    });
    return { company, historical, assumptions, sources, meta };
  }

  compareScalar(meta, 'dataStatus', 'Data status', previous.dataStatus, next.dataStatus);
  compareScalar(meta, 'modelVersion', 'Model version', previous.modelVersion, next.modelVersion);
  compareScalar(meta, 'publicationNotes', 'Publication notes', previous.publicationNotes, next.publicationNotes);

  for (const key of Object.keys(COMPANY_LABELS)) {
    compareScalar(
      company,
      `company.${key}`,
      COMPANY_LABELS[key],
      (previous.company as unknown as Record<string, unknown>)[key],
      (next.company as unknown as Record<string, unknown>)[key],
    );
  }

  // Historical, year by year and line by line.
  const byYear = (rows: HistoricalYear[]) => new Map(rows.map((row) => [row.year, row]));
  const prevYears = byYear(previous.historical);
  const nextYears = byYear(next.historical);
  const allYears = [...new Set([...prevYears.keys(), ...nextYears.keys()])].sort();

  for (const year of allYears) {
    const before = prevYears.get(year);
    const after = nextYears.get(year);
    if (!before && after) {
      historical.push({
        path: `historical.${year}`,
        label: `${year} added`,
        before: 'not published',
        after: `revenue ${show(after.revenue)}`,
        kind: 'added',
      });
      continue;
    }
    if (before && !after) {
      historical.push({
        path: `historical.${year}`,
        label: `${year} removed`,
        before: `revenue ${show(before.revenue)}`,
        after: 'not published',
        kind: 'removed',
      });
      continue;
    }
    if (!before || !after) continue;
    for (const key of HISTORICAL_FIGURE_KEYS) {
      compareScalar(historical, `historical.${year}.${key}`, `${year} ${FIGURE_LABELS[key]}`, before[key], after[key]);
    }
    const prevProv = before.provenance ?? {};
    const nextProv = after.provenance ?? {};
    for (const key of HISTORICAL_FIGURE_KEYS) {
      const p = prevProv[key];
      const n = nextProv[key];
      if (!p && !n) continue;
      compareScalar(
        historical,
        `historical.${year}.${key}.verification`,
        `${year} ${FIGURE_LABELS[key]} verification`,
        p?.verification,
        n?.verification,
      );
      compareScalar(
        historical,
        `historical.${year}.${key}.page`,
        `${year} ${FIGURE_LABELS[key]} page`,
        p?.page,
        n?.page,
      );
    }
  }

  // Assumptions, including the nested cost of capital and bridge objects.
  const readPath = (root: unknown, path: string): unknown =>
    path.split('.').reduce<unknown>((acc, part) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
      return undefined;
    }, root);

  for (const [path, label] of Object.entries(ASSUMPTION_LABELS)) {
    compareScalar(assumptions, `assumptions.${path}`, label, readPath(previous.assumptions, path), readPath(next.assumptions, path));
  }

  for (const scenarioKey of ['bull', 'base', 'bear'] as const) {
    const p = previous.scenarios?.[scenarioKey];
    const n = next.scenarios?.[scenarioKey];
    compareScalar(assumptions, `scenarios.${scenarioKey}.label`, `${scenarioKey} scenario name`, p?.label, n?.label);
    compareScalar(assumptions, `scenarios.${scenarioKey}.notes`, `${scenarioKey} scenario notes`, p?.notes, n?.notes);
    const keys = new Set([...Object.keys(p?.overrides ?? {}), ...Object.keys(n?.overrides ?? {})]);
    for (const key of keys) {
      compareScalar(
        assumptions,
        `scenarios.${scenarioKey}.overrides.${key}`,
        `${scenarioKey} ${ASSUMPTION_LABELS[key] ?? key}`,
        (p?.overrides as Record<string, unknown> | undefined)?.[key],
        (n?.overrides as Record<string, unknown> | undefined)?.[key],
      );
    }
  }

  const prevSources = new Map(previous.sources.map((source) => [source.id, source]));
  const nextSources = new Map(next.sources.map((source) => [source.id, source]));
  for (const id of new Set([...prevSources.keys(), ...nextSources.keys()])) {
    const before = prevSources.get(id);
    const after = nextSources.get(id);
    if (!before) {
      sources.push({ path: `sources.${id}`, label: `Source added: ${after?.label ?? id}`, before: 'not published', after: after?.url ?? '', kind: 'added' });
      continue;
    }
    if (!after) {
      sources.push({ path: `sources.${id}`, label: `Source removed: ${before.label}`, before: before.url, after: 'not published', kind: 'removed' });
      continue;
    }
    for (const key of ['label', 'url', 'reportYear', 'retrievedOn'] as const) {
      compareScalar(sources, `sources.${id}.${key}`, `${before.label} ${key}`, before[key], after[key]);
    }
  }

  return { company, historical, assumptions, sources, meta };
}

export interface ValueMovement {
  label: string;
  before: number | null;
  after: number;
  delta: number | null;
  deltaPct: number | null;
}

/** The headline impact of a pending publication, for the preview panel. */
export function valueMovements(
  previous: ValuationSnapshot['results'] | null,
  next: ValuationSnapshot['results'],
): ValueMovement[] {
  const rows: Array<[string, keyof ValuationSnapshot['results']]> = [
    ['Enterprise value', 'enterpriseValue'],
    ['Equity value', 'equityValue'],
    ['Implied value per share', 'intrinsicValuePerShare'],
    ['Terminal value share of enterprise value', 'terminalValueShareOfEnterpriseValuePct'],
    ['Weighted average cost of capital', 'waccPct'],
  ];

  return rows.map(([label, key]) => {
    const after = next[key];
    const before = previous ? previous[key] : null;
    const delta = before === null ? null : Math.round((after - before) * 100) / 100;
    const deltaPct =
      before === null || before === 0 ? null : Math.round(((after - before) / Math.abs(before)) * 10000) / 100;
    return { label, before, after, delta, deltaPct };
  });
}
