/**
 * Regenerates public/data/valuations.json with the illustrative starter
 * snapshot.
 *
 * Run with: npm run seed
 *
 * Every figure here is a placeholder invented for interface testing. None of
 * it is Asian Paints reported data, and the snapshot is tagged `illustrative`
 * so the dashboard shows the placeholder banner. The script runs the real
 * engine and the real validator, so the file it writes cannot contradict
 * itself: if the numbers do not reconcile, the script exits non-zero.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { calculateDcf } from '../shared/dcf';
import { validateSnapshot } from '../shared/validation';
import { SCHEMA_VERSION } from '../shared/snapshot';
import type {
  FigureProvenance,
  HistoricalFigureKey,
  HistoricalYear,
  ValuationFile,
  ValuationSnapshot,
} from '../shared/types';

const BUILD_DATE = '2026-10-17';

/** Marks a figure as an invented placeholder with no source document. */
const placeholder = (statement: string): FigureProvenance => ({
  sourceId: '',
  page: '',
  statement,
  unit: 'INR crore',
  classification: 'assumption',
  verification: 'unverified',
  note: 'Illustrative placeholder. Replace with the reported figure and its page reference.',
});

interface SeedYear {
  year: string;
  revenue: number;
  ebit: number;
  depreciation: number;
  capex: number;
  receivables: number;
  inventories: number;
  otherOperatingAssets: number;
  tradePayables: number;
  otherOperatingLiabilities: number;
  cashAndEquivalents: number;
  borrowings: number;
  leaseLiabilities: number;
  propertyPlantEquipment: number;
  financeCosts: number;
  operatingCashFlow: number;
  changeInWorkingCapital: number | null;
}

/**
 * Operating working capital is left to derive from the balance sheet lines, and
 * the lines are chosen so it lands on the starter model's original series
 * (3300, 3700, 3900, 4100, 4400). Operating expenses, EBITDA, profit before tax
 * and net profit are computed from the other lines so the cross-statement
 * reconciliation checks pass exactly.
 */
const seed: SeedYear[] = [
  {
    year: 'FY2021-22', revenue: 30000, ebit: 5200, depreciation: 900, capex: 1500,
    receivables: 3600, inventories: 4200, otherOperatingAssets: 500,
    tradePayables: 4300, otherOperatingLiabilities: 700,
    cashAndEquivalents: 1100, borrowings: 3000, leaseLiabilities: 450,
    propertyPlantEquipment: 9000, financeCosts: 240,
    operatingCashFlow: 4450, changeInWorkingCapital: null,
  },
  {
    year: 'FY2022-23', revenue: 34500, ebit: 5600, depreciation: 980, capex: 1850,
    receivables: 3900, inventories: 4500, otherOperatingAssets: 550,
    tradePayables: 4550, otherOperatingLiabilities: 700,
    cashAndEquivalents: 1250, borrowings: 3200, leaseLiabilities: 500,
    propertyPlantEquipment: 9800, financeCosts: 255,
    operatingCashFlow: 4600, changeInWorkingCapital: 400,
  },
  {
    year: 'FY2023-24', revenue: 36000, ebit: 6100, depreciation: 1080, capex: 2200,
    receivables: 4050, inventories: 4700, otherOperatingAssets: 580,
    tradePayables: 4730, otherOperatingLiabilities: 700,
    cashAndEquivalents: 1350, borrowings: 3300, leaseLiabilities: 540,
    propertyPlantEquipment: 10600, financeCosts: 262,
    operatingCashFlow: 5280, changeInWorkingCapital: 200,
  },
  {
    year: 'FY2024-25', revenue: 38200, ebit: 6500, depreciation: 1180, capex: 2400,
    receivables: 4250, inventories: 4900, otherOperatingAssets: 600,
    tradePayables: 4950, otherOperatingLiabilities: 700,
    cashAndEquivalents: 1420, borrowings: 3350, leaseLiabilities: 570,
    propertyPlantEquipment: 11400, financeCosts: 266,
    operatingCashFlow: 5700, changeInWorkingCapital: 200,
  },
  {
    year: 'FY2025-26', revenue: 40500, ebit: 7000, depreciation: 1280, capex: 2600,
    receivables: 4500, inventories: 5150, otherOperatingAssets: 620,
    tradePayables: 5170, otherOperatingLiabilities: 700,
    cashAndEquivalents: 1500, borrowings: 3400, leaseLiabilities: 600,
    propertyPlantEquipment: 12200, financeCosts: 270,
    operatingCashFlow: 6180, changeInWorkingCapital: 300,
  },
];

const TAX_RATE = 0.25;
const DILUTED_SHARES = 95;

const statementFor: Partial<Record<HistoricalFigureKey, string>> = {
  revenue: 'Statement of profit and loss',
  operatingExpenses: 'Statement of profit and loss',
  ebitda: 'Derived from the statement of profit and loss',
  depreciation: 'Statement of profit and loss',
  ebit: 'Derived from the statement of profit and loss',
  financeCosts: 'Statement of profit and loss',
  profitBeforeTax: 'Statement of profit and loss',
  taxExpense: 'Statement of profit and loss',
  netProfit: 'Statement of profit and loss',
  cashAndEquivalents: 'Balance sheet',
  borrowings: 'Balance sheet',
  receivables: 'Balance sheet',
  inventories: 'Balance sheet',
  tradePayables: 'Balance sheet',
  propertyPlantEquipment: 'Balance sheet',
  otherOperatingAssets: 'Balance sheet',
  otherOperatingLiabilities: 'Balance sheet',
  leaseLiabilities: 'Balance sheet',
  operatingCashFlow: 'Cash flow statement',
  capex: 'Cash flow statement',
  changeInWorkingCapital: 'Cash flow statement',
  dilutedShares: 'Earnings per share note',
};

const historical: HistoricalYear[] = seed.map((row) => {
  const ebitda = row.ebit + row.depreciation;
  const operatingExpenses = row.revenue - row.ebit - row.depreciation;
  const profitBeforeTax = row.ebit - row.financeCosts;
  const taxExpense = Math.round(profitBeforeTax * TAX_RATE);
  const netProfit = profitBeforeTax - taxExpense;

  const figures: Record<string, number | null> = {
    revenue: row.revenue,
    operatingExpenses,
    ebitda,
    depreciation: row.depreciation,
    ebit: row.ebit,
    financeCosts: row.financeCosts,
    profitBeforeTax,
    taxExpense,
    netProfit,
    cashAndEquivalents: row.cashAndEquivalents,
    borrowings: row.borrowings,
    receivables: row.receivables,
    inventories: row.inventories,
    tradePayables: row.tradePayables,
    propertyPlantEquipment: row.propertyPlantEquipment,
    otherOperatingAssets: row.otherOperatingAssets,
    otherOperatingLiabilities: row.otherOperatingLiabilities,
    leaseLiabilities: row.leaseLiabilities,
    nonControllingInterests: 0,
    nonOperatingInvestments: 0,
    operatingCashFlow: row.operatingCashFlow,
    capex: row.capex,
    changeInWorkingCapital: row.changeInWorkingCapital,
    otherInvestingItems: null,
    dilutedShares: DILUTED_SHARES,
    operatingNwc: null,
  };

  const provenance: Partial<Record<HistoricalFigureKey, FigureProvenance>> = {};
  for (const [key, value] of Object.entries(figures)) {
    if (value === null) continue;
    const typedKey = key as HistoricalFigureKey;
    if (typedKey === 'operatingNwc') continue;
    provenance[typedKey] = placeholder(statementFor[typedKey] ?? 'Illustrative placeholder');
  }

  return { year: row.year, ...figures, provenance } as unknown as HistoricalYear;
});

const assumptions: ValuationSnapshot['assumptions'] = {
  // Flat fallbacks. The per-year overrides below take precedence where set.
  revenueGrowthPct: 7,
  ebitMarginPct: 17,
  taxRatePct: 25,
  depreciationPctRevenue: 3.2,
  capexPctRevenue: 6,
  nwcPctIncrementalRevenue: 18,
  // Derived from the build-up below. Kept in sync as the legacy fallback.
  waccPct: 10.5036,
  terminalGrowthPct: 4,
  // Legacy single net debt figure, superseded by the bridge. 3400 + 600 - 1500.
  netDebtCrore: 2500,
  dilutedSharesCrore: DILUTED_SHARES,

  forecastYears: 5,
  firstForecastYearLabel: 'FY2026-27',
  perYear: {
    revenueGrowthPct: [8, 7.5, 7, 6.5, 6],
    ebitMarginPct: [17, 17.25, 17.5, 17.5, 17.5],
  },
  capexMethod: 'pctRevenue',
  nwcMethod: 'pctIncrementalRevenue',
  midYearConvention: false,
  wacc: {
    mode: 'derived',
    riskFreeRatePct: 6.8,
    betaLevered: 0.73,
    equityRiskPremiumPct: 5.5,
    additionalEquityPremiumPct: 0,
    costOfDebtPreTaxPct: 7.5,
    marginalTaxRatePct: 25,
    equityWeightPct: 94,
    debtWeightPct: 6,
    manualWaccPct: 10.5,
  },
  bridge: {
    grossDebt: 3400,
    leaseLiabilities: 600,
    leasesIncludedInGrossDebt: false,
    leaseTreatment: 'capitalised',
    cashAndEquivalents: 1500,
    nonOperatingInvestments: 0,
    nonControllingInterests: 0,
    otherClaims: 0,
    dilutedShares: DILUTED_SHARES,
  },
};

const snapshotWithoutResults: Omit<ValuationSnapshot, 'results'> = {
  id: `snap-${BUILD_DATE}`,
  createdAt: `${BUILD_DATE}T00:00:00.000Z`,
  publishedBy: 'repository-seed',
  modelVersion: '1.0.0',
  publicationNotes:
    'Starter snapshot shipped with the repository. Interface and formula test data only. Replace it with extracted statements before publishing any company-specific conclusion.',
  dataStatus: 'illustrative',
  company: {
    name: 'Asian Paints',
    ticker: 'ASIANPAINT',
    exchange: 'NSE',
    sector: 'Decorative paints and coatings',
    currency: 'INR',
    units: 'INR crore, except per-share figures',
    consolidationBasis: 'Consolidated',
    fiscalYearEnd: '31 March',
    reportingPeriod: 'FY2025-26',
    valuationDate: BUILD_DATE,
    publicationDate: BUILD_DATE,
    researchNotes:
      'This snapshot exists to exercise the model, the editor and the publication pipeline. The figures are invented placeholders chosen to reconcile with each other, not numbers read off an annual report, and no valuation conclusion should be drawn from them.\n\nTo turn this into real research: extract the consolidated statements for 5 years, enter each figure with its report, page and unit, set every reported line to verified, re-derive the cost of capital with dated market inputs, then set the data status to verified and publish.',
  },
  sources: [
    {
      id: 'annual-report-placeholder',
      label: 'Placeholder source entry, replace with the consolidated annual report used for extraction',
      url: 'https://example.com/replace-with-annual-report-pdf',
      reportYear: 'FY2024-25',
      retrievedOn: BUILD_DATE,
      notes:
        'No figure is linked to this entry. It is here to show the shape of a source record. Add the real document link, then attach each reported figure to it with a page number.',
    },
  ],
  historical,
  assumptions,
  scenarios: {
    bull: {
      label: 'Bull',
      notes:
        'Faster volume growth with premium mix holding, a lower discount rate, and terminal growth closer to nominal economic growth.',
      overrides: { revenueGrowthPct: 9, ebitMarginPct: 18.5, waccPct: 9.75, terminalGrowthPct: 4.5 },
    },
    base: {
      label: 'Base',
      notes: 'The published assumption set, with growth tapering from 8% to 6% across the forecast.',
      overrides: {},
    },
    bear: {
      label: 'Bear',
      notes:
        'Competitive entry compresses pricing, input costs stay elevated, and the market demands a higher return.',
      overrides: { revenueGrowthPct: 4.5, ebitMarginPct: 15, waccPct: 11.5, terminalGrowthPct: 3.25 },
    },
  },
  sensitivity: {
    waccPct: [8.5, 9.5, 10.5, 11.5, 12.5],
    terminalGrowthPct: [2, 3, 4, 5, 6],
  },
};

const run = calculateDcf(historical, assumptions);

const snapshot: ValuationSnapshot = {
  ...snapshotWithoutResults,
  results: {
    enterpriseValue: run.enterpriseValue,
    equityValue: run.equityValue,
    intrinsicValuePerShare: run.intrinsicValuePerShare,
    terminalValueShareOfEnterpriseValuePct: run.terminalValueShareOfEnterpriseValuePct,
    waccPct: run.wacc.waccPct,
  },
};

const validation = validateSnapshot(snapshot);
if (!validation.ok) {
  console.error('Seed snapshot failed validation:');
  for (const issue of validation.errors) {
    console.error(`  ${issue.path}: ${issue.message}`);
  }
  process.exit(1);
}

const file: ValuationFile = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt: `${BUILD_DATE}T00:00:00.000Z`,
  current: snapshot.id,
  snapshots: [snapshot],
};

const target = resolve(process.cwd(), 'public/data/valuations.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`, 'utf8');

console.log(`Wrote ${target}`);
console.log(`  WACC                 ${run.wacc.waccPct}%`);
console.log(`  Enterprise value     ${run.enterpriseValue}`);
console.log(`  Equity value         ${run.equityValue}`);
console.log(`  Value per share      ${run.intrinsicValuePerShare}`);
console.log(`  Terminal value share ${run.terminalValueShareOfEnterpriseValuePct}%`);
console.log(`  Warnings             ${validation.warnings.length}`);
for (const issue of validation.warnings) console.log(`    - ${issue.path}: ${issue.message}`);
