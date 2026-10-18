/**
 * Canonical data contract for DCF Valuation Lab.
 *
 * This module is imported by BOTH the browser bundle (src/) and the
 * Cloudflare Pages Functions (functions/). Keep it dependency-free and
 * side-effect-free so either runtime can load it.
 */

/** How trustworthy the whole snapshot is. Drives the public data badge. */
export type DataStatus = 'illustrative' | 'in-review' | 'verified';

/** Whether a figure was read off a report, computed, or chosen by the analyst. */
export type Classification = 'reported' | 'derived' | 'assumption';

/** How far a reported figure has been checked against its source document. */
export type Verification = 'unverified' | 'cross-checked' | 'verified';

/** How the model treats leases, which decides whether lease liabilities are deducted. */
export type LeaseTreatment = 'capitalised' | 'expensed';

export interface SourceDocument {
  /** Stable slug referenced by FigureProvenance.sourceId. */
  id: string;
  /** Human label, for example "Integrated Annual Report 2024-25". */
  label: string;
  /** Public link to the document. Validated as http(s) on the server. */
  url: string;
  /** Financial year the document reports on, for example "FY2024-25". */
  reportYear: string;
  /** ISO date the analyst downloaded or last checked the document. */
  retrievedOn: string;
  notes?: string;
}

export interface FigureProvenance {
  /** Empty string for assumptions and derived figures with no single source. */
  sourceId: string;
  /** Page or page range inside the source document, for example "142" or "142-144". */
  page: string;
  /** Statement the figure sits in, for example "Consolidated balance sheet". */
  statement: string;
  /** Unit as printed in the source, for example "INR crore". */
  unit: string;
  classification: Classification;
  verification: Verification;
  note?: string;
}

/** Keys of HistoricalYear that hold a financial figure and can carry provenance. */
export const HISTORICAL_FIGURE_KEYS = [
  'revenue',
  'operatingExpenses',
  'ebitda',
  'depreciation',
  'ebit',
  'financeCosts',
  'profitBeforeTax',
  'taxExpense',
  'netProfit',
  'cashAndEquivalents',
  'borrowings',
  'receivables',
  'inventories',
  'tradePayables',
  'propertyPlantEquipment',
  'otherOperatingAssets',
  'otherOperatingLiabilities',
  'leaseLiabilities',
  'nonControllingInterests',
  'nonOperatingInvestments',
  'operatingCashFlow',
  'capex',
  'changeInWorkingCapital',
  'otherInvestingItems',
  'dilutedShares',
  'operatingNwc',
] as const;

export type HistoricalFigureKey = (typeof HISTORICAL_FIGURE_KEYS)[number];

/**
 * One reported financial year. Figures are in the snapshot's reporting unit
 * (INR crore in the shipped dataset) except dilutedShares, which is a share count.
 *
 * Only revenue, depreciation, ebit and capex are required by the engine.
 * Everything else may be null when the analyst has not extracted it yet.
 */
export interface HistoricalYear {
  /** Label such as "FY2024-25". Used as the row key, so it must be unique. */
  year: string;

  // Income statement
  revenue: number;
  operatingExpenses: number | null;
  ebitda: number | null;
  depreciation: number;
  ebit: number;
  financeCosts: number | null;
  profitBeforeTax: number | null;
  taxExpense: number | null;
  netProfit: number | null;

  // Balance sheet
  cashAndEquivalents: number | null;
  borrowings: number | null;
  receivables: number | null;
  inventories: number | null;
  tradePayables: number | null;
  propertyPlantEquipment: number | null;
  otherOperatingAssets: number | null;
  otherOperatingLiabilities: number | null;
  leaseLiabilities: number | null;
  nonControllingInterests: number | null;
  nonOperatingInvestments: number | null;

  // Cash flow statement
  operatingCashFlow: number | null;
  capex: number;
  changeInWorkingCapital: number | null;
  otherInvestingItems: number | null;

  // Capital structure
  dilutedShares: number | null;

  /**
   * Operating net working capital. When null the engine derives it as
   * receivables + inventories + other operating assets
   * - trade payables - other operating liabilities.
   */
  operatingNwc: number | null;

  /** Per-figure source trail, keyed by HistoricalFigureKey. */
  provenance: Partial<Record<HistoricalFigureKey, FigureProvenance>>;
}

/** Minimum shape the DCF engine needs from a historical year. */
export interface EngineHistoricalYear {
  year: string;
  revenue: number;
  ebit: number;
  depreciation: number;
  capex: number;
  operatingNwc: number;
}

/** Weighted average cost of capital build-up. */
export interface WaccInputs {
  /** 'derived' computes WACC from the components below; 'manual' uses manualWaccPct. */
  mode: 'derived' | 'manual';
  riskFreeRatePct: number;
  betaLevered: number;
  equityRiskPremiumPct: number;
  /** Size, country or other documented add-on to the cost of equity. */
  additionalEquityPremiumPct: number;
  costOfDebtPreTaxPct: number;
  /** Marginal rate used for the debt tax shield. May differ from the operating tax rate. */
  marginalTaxRatePct: number;
  equityWeightPct: number;
  debtWeightPct: number;
  manualWaccPct: number;
}

/**
 * Enterprise value to equity value bridge.
 *
 * leaseTreatment and leasesIncludedInGrossDebt exist to stop double counting:
 * a lease liability is only deducted when the model capitalises leases, and it
 * is never deducted twice when it already sits inside grossDebt.
 */
export interface EquityBridge {
  grossDebt: number;
  leaseLiabilities: number;
  leasesIncludedInGrossDebt: boolean;
  leaseTreatment: LeaseTreatment;
  cashAndEquivalents: number;
  nonOperatingInvestments: number;
  nonControllingInterests: number;
  /** Preference capital, pension deficits and similar debt-like claims. */
  otherClaims: number;
  /** Diluted share count in the same unit as the per-share output denominator. */
  dilutedShares: number;
}

export type PerYearDriverKey =
  | 'revenueGrowthPct'
  | 'ebitMarginPct'
  | 'taxRatePct'
  | 'depreciationPctRevenue'
  | 'capexPctRevenue'
  | 'nwcPctIncrementalRevenue';

/** Year-by-year overrides. A null entry falls back to the flat driver. */
export type PerYearOverrides = Partial<Record<PerYearDriverKey, (number | null)[]>>;

export interface ModelAssumptions {
  // Flat drivers. These are the defaults for every forecast year.
  revenueGrowthPct: number;
  ebitMarginPct: number;
  taxRatePct: number;
  depreciationPctRevenue: number;
  capexPctRevenue: number;
  nwcPctIncrementalRevenue: number;
  /** Effective discount rate. Recomputed from `wacc` when wacc.mode is 'derived'. */
  waccPct: number;
  terminalGrowthPct: number;
  /**
   * Legacy single net debt figure. Used only when `bridge` is absent, so the
   * original starter assumptions object still calculates.
   */
  netDebtCrore: number;
  /** Legacy diluted share count. Superseded by bridge.dilutedShares when present. */
  dilutedSharesCrore: number;

  // Extensions. All optional so the original assumptions shape still validates.
  forecastYears?: number;
  /** Label of the first forecast year, for example "FY2026-27". */
  firstForecastYearLabel?: string;
  perYear?: PerYearOverrides;
  capexMethod?: 'pctRevenue' | 'pctIncrementalRevenue';
  nwcMethod?: 'pctIncrementalRevenue' | 'pctRevenue';
  /** Discount at the middle of each year rather than the end. */
  midYearConvention?: boolean;
  wacc?: WaccInputs;
  bridge?: EquityBridge;
}

export interface ForecastYear {
  year: string;
  revenue: number;
  revenueGrowthPct: number;
  ebit: number;
  ebitMarginPct: number;
  taxesOnEbit: number;
  nopat: number;
  depreciation: number;
  capex: number;
  changeInNwc: number;
  fcff: number;
  discountFactor: number;
  presentValueFcff: number;
}

/** One line of the enterprise to equity walk, in presentation order. */
export interface BridgeLine {
  key: string;
  label: string;
  /** Signed contribution to equity value. */
  amount: number;
  /** Running total after this line. */
  runningTotal: number;
  kind: 'start' | 'add' | 'subtract' | 'total';
  note?: string;
}

export interface WaccBreakdown {
  mode: 'derived' | 'manual';
  costOfEquityPct: number;
  costOfDebtPreTaxPct: number;
  costOfDebtAfterTaxPct: number;
  equityWeightPct: number;
  debtWeightPct: number;
  waccPct: number;
}

export interface DcfResult {
  forecast: ForecastYear[];
  terminalValue: number;
  presentValueTerminalValue: number;
  presentValueForecastCashFlows: number;
  enterpriseValue: number;
  equityValue: number;
  intrinsicValuePerShare: number;
  terminalValueShareOfEnterpriseValuePct: number;
  /** Explicit, auditable walk from enterprise value to equity value. */
  bridge: BridgeLine[];
  wacc: WaccBreakdown;
  /** Non-fatal model warnings, for example a terminal growth rate above 6%. */
  warnings: string[];
}

export interface ScenarioDefinition {
  label: string;
  notes: string;
  /** Driver overrides applied on top of the base assumptions. */
  overrides: Partial<
    Pick<
      ModelAssumptions,
      | 'revenueGrowthPct'
      | 'ebitMarginPct'
      | 'taxRatePct'
      | 'depreciationPctRevenue'
      | 'capexPctRevenue'
      | 'nwcPctIncrementalRevenue'
      | 'waccPct'
      | 'terminalGrowthPct'
    >
  >;
}

export interface SensitivityAxes {
  waccPct: number[];
  terminalGrowthPct: number[];
}

export interface CompanyProfile {
  name: string;
  ticker: string;
  exchange: string;
  sector: string;
  currency: string;
  /** Unit statement shown beside every table, for example "INR crore". */
  units: string;
  consolidationBasis: 'Consolidated' | 'Standalone';
  fiscalYearEnd: string;
  /** Latest reported period in the historical series. */
  reportingPeriod: string;
  /** ISO date the valuation is struck as of. */
  valuationDate: string;
  /** ISO date this snapshot was published. */
  publicationDate: string;
  researchNotes: string;
}

/** One immutable published research release. */
export interface ValuationSnapshot {
  id: string;
  createdAt: string;
  publishedBy: string;
  modelVersion: string;
  publicationNotes: string;
  dataStatus: DataStatus;
  company: CompanyProfile;
  sources: SourceDocument[];
  historical: HistoricalYear[];
  assumptions: ModelAssumptions;
  scenarios: Record<'bull' | 'base' | 'bear', ScenarioDefinition>;
  sensitivity: SensitivityAxes;
  /**
   * Outputs as recomputed on the server at publication time. Stored for audit
   * only. The dashboard always recalculates from inputs and never trusts these.
   */
  results: {
    enterpriseValue: number;
    equityValue: number;
    intrinsicValuePerShare: number;
    terminalValueShareOfEnterpriseValuePct: number;
    waccPct: number;
  };
  /** Commit that introduced this snapshot. Filled in after the write lands. */
  commitSha?: string;
}

export interface ValuationFile {
  schemaVersion: number;
  generatedAt: string;
  /** Snapshot id the public dashboard shows by default. */
  current: string;
  snapshots: ValuationSnapshot[];
}

export interface SessionUser {
  login: string;
  githubId: number;
  avatarUrl: string;
  expiresAt: string;
}

export interface SessionResponse {
  authenticated: boolean;
  user: SessionUser | null;
  /** Double-submit token bound to the session. Sent as X-CSRF-Token on writes. */
  csrfToken: string | null;
  /** True when the GitHub write credential is configured on the server. */
  publishConfigured: boolean;
}

export interface PublishResponse {
  ok: true;
  commitSha: string;
  commitUrl: string;
  snapshotId: string;
  snapshotCount: number;
  results: ValuationSnapshot['results'];
}

export interface ApiErrorResponse {
  ok: false;
  /** Stable machine code. Safe to show. Never carries secrets. */
  code: string;
  /** One or two blameless sentences for the interface. */
  message: string;
  /** Field-level validation detail, when the failure is a validation failure. */
  issues?: ValidationIssue[];
  /** Short opaque reference the analyst can quote when reading server logs. */
  ref?: string;
}

export interface ValidationIssue {
  /** Dotted path into the submitted snapshot, for example "historical.2.revenue". */
  path: string;
  message: string;
  severity: 'error' | 'warning';
}
