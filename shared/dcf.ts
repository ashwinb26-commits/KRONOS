/**
 * DCF calculation engine.
 *
 * Built on the starter engine's free cash flow to the firm logic, which is kept
 * intact: revenue rolls forward at the growth driver, EBIT comes off the margin
 * driver, taxes are charged on positive EBIT only, and
 *
 *   FCFF = EBIT x (1 - tax rate) + D&A - capex - change in operating NWC
 *
 * What is added on top: a weighted average cost of capital build-up, year by
 * year driver overrides, an explicit enterprise to equity bridge that cannot
 * double count leases, and typed errors instead of silent wrong numbers.
 */

import type {
  BridgeLine,
  DcfResult,
  EngineHistoricalYear,
  EquityBridge,
  ForecastYear,
  HistoricalYear,
  ModelAssumptions,
  PerYearDriverKey,
  ScenarioDefinition,
  SensitivityAxes,
  WaccBreakdown,
  WaccInputs,
} from './types';

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const round4 = (value: number) => Math.round((value + Number.EPSILON) * 10000) / 10000;

/** Thrown when the assumptions cannot produce a meaningful valuation. */
export class DcfError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DcfError';
    this.code = code;
  }
}

export const DEFAULT_WACC_INPUTS: WaccInputs = {
  mode: 'manual',
  riskFreeRatePct: 7,
  betaLevered: 1,
  equityRiskPremiumPct: 6,
  additionalEquityPremiumPct: 0,
  costOfDebtPreTaxPct: 8,
  marginalTaxRatePct: 25,
  equityWeightPct: 100,
  debtWeightPct: 0,
  manualWaccPct: 10.5,
};

export const DEFAULT_EQUITY_BRIDGE: EquityBridge = {
  grossDebt: 0,
  leaseLiabilities: 0,
  leasesIncludedInGrossDebt: false,
  leaseTreatment: 'capitalised',
  cashAndEquivalents: 0,
  nonOperatingInvestments: 0,
  nonControllingInterests: 0,
  otherClaims: 0,
  dilutedShares: 1,
};

const FINITE = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Turn "FY2024-25" into "FY2025-26". Falls back to null on an unrecognised
 * label so the caller can use a numeric sequence instead.
 */
export function nextFinancialYearLabel(label: string): string | null {
  const match = /^FY(\d{4})-(\d{2})$/.exec(label.trim());
  if (!match) return null;
  const start = Number(match[1]) + 1;
  return `FY${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Operating net working capital for a reported year.
 *
 * Uses the explicit figure when the analyst entered one. Otherwise derives it
 * from the operating balance sheet lines, deliberately excluding cash and all
 * financing items so the change in NWC does not pick up financing movements.
 */
export function deriveOperatingNwc(year: HistoricalYear): number {
  if (FINITE(year.operatingNwc)) return year.operatingNwc;
  const assets =
    (year.receivables ?? 0) + (year.inventories ?? 0) + (year.otherOperatingAssets ?? 0);
  const liabilities = (year.tradePayables ?? 0) + (year.otherOperatingLiabilities ?? 0);
  return assets - liabilities;
}

/** Reduce a full reported year to the five fields the engine consumes. */
export function toEngineHistory(
  history: Array<HistoricalYear | EngineHistoricalYear>,
): EngineHistoricalYear[] {
  return history.map((row) => {
    const full = row as HistoricalYear;
    const operatingNwc =
      'provenance' in row ? deriveOperatingNwc(full) : (row as EngineHistoricalYear).operatingNwc;
    return {
      year: row.year,
      revenue: row.revenue,
      ebit: row.ebit,
      depreciation: row.depreciation,
      capex: row.capex,
      operatingNwc: FINITE(operatingNwc) ? operatingNwc : 0,
    };
  });
}

/**
 * Weighted average cost of capital.
 *
 *   cost of equity = risk free rate + beta x equity risk premium + add-on
 *   WACC = equity weight x cost of equity + debt weight x cost of debt x (1 - marginal tax rate)
 *
 * In 'manual' mode the analyst's single WACC figure is used and the components
 * are still reported so the public dashboard can show what was assumed.
 */
export function calculateWacc(inputs: WaccInputs): WaccBreakdown {
  const costOfEquityPct =
    inputs.riskFreeRatePct +
    inputs.betaLevered * inputs.equityRiskPremiumPct +
    inputs.additionalEquityPremiumPct;
  const costOfDebtAfterTaxPct =
    inputs.costOfDebtPreTaxPct * (1 - inputs.marginalTaxRatePct / 100);

  if (inputs.mode === 'manual') {
    return {
      mode: 'manual',
      costOfEquityPct: round4(costOfEquityPct),
      costOfDebtPreTaxPct: round4(inputs.costOfDebtPreTaxPct),
      costOfDebtAfterTaxPct: round4(costOfDebtAfterTaxPct),
      equityWeightPct: round4(inputs.equityWeightPct),
      debtWeightPct: round4(inputs.debtWeightPct),
      waccPct: round4(inputs.manualWaccPct),
    };
  }

  const weightSum = inputs.equityWeightPct + inputs.debtWeightPct;
  if (Math.abs(weightSum - 100) > 0.01) {
    throw new DcfError(
      'wacc_weights',
      `Capital weights add up to ${round2(weightSum)}%. Equity and debt weights must total 100%.`,
    );
  }

  const waccPct =
    (inputs.equityWeightPct / 100) * costOfEquityPct +
    (inputs.debtWeightPct / 100) * costOfDebtAfterTaxPct;

  return {
    mode: 'derived',
    costOfEquityPct: round4(costOfEquityPct),
    costOfDebtPreTaxPct: round4(inputs.costOfDebtPreTaxPct),
    costOfDebtAfterTaxPct: round4(costOfDebtAfterTaxPct),
    equityWeightPct: round4(inputs.equityWeightPct),
    debtWeightPct: round4(inputs.debtWeightPct),
    waccPct: round4(waccPct),
  };
}

/** The discount rate the engine will actually use for a set of assumptions. */
export function effectiveWaccPct(assumptions: ModelAssumptions): number {
  if (!assumptions.wacc) return assumptions.waccPct;
  return calculateWacc(assumptions.wacc).waccPct;
}

function driverForYear(
  assumptions: ModelAssumptions,
  key: PerYearDriverKey,
  index: number,
): number {
  const overrides = assumptions.perYear?.[key];
  const candidate = overrides?.[index];
  return FINITE(candidate) ? candidate : (assumptions[key] as number);
}

/**
 * Walk enterprise value down to equity value.
 *
 * A lease liability is deducted once, or not at all:
 *  - leaseTreatment 'expensed' means lease costs already sit inside EBIT, so
 *    deducting the liability as well would charge for the same thing twice.
 *  - leasesIncludedInGrossDebt means the figure is already inside grossDebt.
 */
export function buildEquityBridge(
  enterpriseValue: number,
  bridge: EquityBridge,
): { lines: BridgeLine[]; equityValue: number; warnings: string[] } {
  const warnings: string[] = [];
  const lines: BridgeLine[] = [];
  let running = enterpriseValue;

  const push = (
    key: string,
    label: string,
    amount: number,
    kind: BridgeLine['kind'],
    note?: string,
  ) => {
    running += amount;
    lines.push({ key, label, amount: round2(amount), runningTotal: round2(running), kind, note });
  };

  lines.push({
    key: 'enterpriseValue',
    label: 'Enterprise value',
    amount: round2(enterpriseValue),
    runningTotal: round2(enterpriseValue),
    kind: 'start',
  });

  const leasesCounted =
    bridge.leaseTreatment === 'capitalised' && !bridge.leasesIncludedInGrossDebt;

  if (bridge.grossDebt !== 0) {
    push(
      'grossDebt',
      bridge.leasesIncludedInGrossDebt ? 'Less gross debt, leases included' : 'Less gross debt',
      -bridge.grossDebt,
      'subtract',
    );
  }

  if (bridge.leaseLiabilities !== 0) {
    if (leasesCounted) {
      push('leaseLiabilities', 'Less lease liabilities', -bridge.leaseLiabilities, 'subtract');
    } else if (bridge.leasesIncludedInGrossDebt) {
      warnings.push(
        'Lease liabilities are already inside gross debt, so they are not deducted a second time.',
      );
    } else {
      warnings.push(
        'Lease costs are expensed inside EBIT in this model, so lease liabilities are not deducted. Deducting them as well would charge for the same obligation twice.',
      );
    }
  }

  if (bridge.nonControllingInterests !== 0) {
    push(
      'nonControllingInterests',
      'Less non-controlling interests',
      -bridge.nonControllingInterests,
      'subtract',
    );
  }

  if (bridge.otherClaims !== 0) {
    push(
      'otherClaims',
      'Less other debt-like claims',
      -bridge.otherClaims,
      'subtract',
      'Preference capital, pension deficits and similar claims ranking ahead of equity.',
    );
  }

  if (bridge.cashAndEquivalents !== 0) {
    push('cashAndEquivalents', 'Add cash and equivalents', bridge.cashAndEquivalents, 'add');
  }

  if (bridge.nonOperatingInvestments !== 0) {
    push(
      'nonOperatingInvestments',
      'Add non-operating investments',
      bridge.nonOperatingInvestments,
      'add',
      'Holdings whose returns are not inside forecast free cash flow.',
    );
  }

  lines.push({
    key: 'equityValue',
    label: 'Equity value',
    amount: round2(running),
    runningTotal: round2(running),
    kind: 'total',
  });

  return { lines, equityValue: round2(running), warnings };
}

/**
 * Run the model.
 *
 * Throws DcfError for assumptions that cannot produce a valuation, rather than
 * returning a number that looks plausible and is wrong.
 */
export function calculateDcf(
  historical: Array<HistoricalYear | EngineHistoricalYear>,
  assumptions: ModelAssumptions,
  forecastYearsArg?: number,
): DcfResult {
  const history = toEngineHistory(historical);
  if (history.length === 0) {
    throw new DcfError('no_history', 'At least one historical year is required.');
  }

  const bridge = assumptions.bridge;
  const shares = bridge ? bridge.dilutedShares : assumptions.dilutedSharesCrore;
  if (!FINITE(shares) || shares <= 0) {
    throw new DcfError('shares', 'Diluted shares must be greater than zero.');
  }

  const waccBreakdown = assumptions.wacc
    ? calculateWacc(assumptions.wacc)
    : calculateWacc({ ...DEFAULT_WACC_INPUTS, mode: 'manual', manualWaccPct: assumptions.waccPct });
  const waccPct = waccBreakdown.waccPct;

  if (!FINITE(waccPct) || waccPct <= 0) {
    throw new DcfError('wacc', 'The weighted average cost of capital must be greater than zero.');
  }
  if (waccPct <= assumptions.terminalGrowthPct) {
    throw new DcfError(
      'terminal_growth',
      'WACC must be greater than terminal growth. A terminal growth rate at or above the discount rate gives an infinite value.',
    );
  }

  const forecastYears = forecastYearsArg ?? assumptions.forecastYears ?? 5;
  if (!Number.isInteger(forecastYears) || forecastYears < 1 || forecastYears > 15) {
    throw new DcfError('forecast_years', 'The forecast period must be a whole number of 1 to 15 years.');
  }

  const lastHistorical = history[history.length - 1];
  let previousRevenue = lastHistorical.revenue;
  if (!FINITE(previousRevenue) || previousRevenue <= 0) {
    throw new DcfError(
      'base_revenue',
      'The latest historical year needs a positive revenue figure to forecast from.',
    );
  }

  let yearLabel = assumptions.firstForecastYearLabel ?? nextFinancialYearLabel(lastHistorical.year);
  const forecast: ForecastYear[] = [];
  const warnings: string[] = [];

  for (let i = 1; i <= forecastYears; i += 1) {
    const growthPct = driverForYear(assumptions, 'revenueGrowthPct', i - 1);
    const marginPct = driverForYear(assumptions, 'ebitMarginPct', i - 1);
    const taxPct = driverForYear(assumptions, 'taxRatePct', i - 1);
    const depPct = driverForYear(assumptions, 'depreciationPctRevenue', i - 1);
    const capexPct = driverForYear(assumptions, 'capexPctRevenue', i - 1);
    const nwcPct = driverForYear(assumptions, 'nwcPctIncrementalRevenue', i - 1);

    const revenue = previousRevenue * (1 + growthPct / 100);
    const ebit = revenue * (marginPct / 100);
    const taxesOnEbit = Math.max(0, ebit * (taxPct / 100));
    const nopat = ebit - taxesOnEbit;
    const depreciation = revenue * (depPct / 100);
    const incrementalRevenue = revenue - previousRevenue;
    const capex =
      assumptions.capexMethod === 'pctIncrementalRevenue'
        ? incrementalRevenue * (capexPct / 100)
        : revenue * (capexPct / 100);
    const changeInNwc =
      assumptions.nwcMethod === 'pctRevenue'
        ? revenue * (nwcPct / 100) - previousRevenue * (nwcPct / 100)
        : incrementalRevenue * (nwcPct / 100);
    const fcff = nopat + depreciation - capex - changeInNwc;

    const exponent = assumptions.midYearConvention ? i - 0.5 : i;
    const discountFactor = 1 / (1 + waccPct / 100) ** exponent;

    const label = yearLabel ?? `FY${2025 + i}-${String((2026 + i) % 100).padStart(2, '0')}`;

    forecast.push({
      year: label,
      revenue: round2(revenue),
      revenueGrowthPct: round4(growthPct),
      ebit: round2(ebit),
      ebitMarginPct: round4(marginPct),
      taxesOnEbit: round2(taxesOnEbit),
      nopat: round2(nopat),
      depreciation: round2(depreciation),
      capex: round2(capex),
      changeInNwc: round2(changeInNwc),
      fcff: round2(fcff),
      discountFactor: round4(discountFactor),
      presentValueFcff: round2(fcff * discountFactor),
    });

    previousRevenue = revenue;
    yearLabel = yearLabel ? nextFinancialYearLabel(yearLabel) : null;
  }

  const finalFcff = forecast[forecast.length - 1].fcff;
  if (finalFcff <= 0) {
    throw new DcfError(
      'terminal_fcff',
      'Free cash flow in the final forecast year is zero or negative, so the perpetual growth formula cannot produce a meaningful terminal value. Extend the forecast until cash flow turns positive, or value the company another way.',
    );
  }

  const terminalValue =
    (finalFcff * (1 + assumptions.terminalGrowthPct / 100)) /
    ((waccPct - assumptions.terminalGrowthPct) / 100);
  const terminalExponent = assumptions.midYearConvention ? forecastYears - 0.5 : forecastYears;
  const presentValueTerminalValue = terminalValue / (1 + waccPct / 100) ** terminalExponent;
  const presentValueForecastCashFlows = forecast.reduce(
    (sum, item) => sum + item.presentValueFcff,
    0,
  );
  const enterpriseValue = presentValueForecastCashFlows + presentValueTerminalValue;

  let bridgeLines: BridgeLine[];
  let equityValue: number;

  if (bridge) {
    const built = buildEquityBridge(enterpriseValue, bridge);
    bridgeLines = built.lines;
    equityValue = built.equityValue;
    warnings.push(...built.warnings);
  } else {
    // Legacy path: a single net debt figure, as in the starter model.
    equityValue = round2(enterpriseValue - assumptions.netDebtCrore);
    bridgeLines = [
      {
        key: 'enterpriseValue',
        label: 'Enterprise value',
        amount: round2(enterpriseValue),
        runningTotal: round2(enterpriseValue),
        kind: 'start',
      },
      {
        key: 'netDebt',
        label: 'Less net debt',
        amount: round2(-assumptions.netDebtCrore),
        runningTotal: equityValue,
        kind: 'subtract',
      },
      {
        key: 'equityValue',
        label: 'Equity value',
        amount: equityValue,
        runningTotal: equityValue,
        kind: 'total',
      },
    ];
  }

  const terminalShare =
    enterpriseValue > 0 ? round2((presentValueTerminalValue / enterpriseValue) * 100) : 0;

  if (assumptions.terminalGrowthPct > 6) {
    warnings.push(
      `Terminal growth of ${assumptions.terminalGrowthPct}% sits above long-run nominal growth for most economies. Document why the company can compound faster than its economy forever.`,
    );
  }
  if (terminalShare > 80) {
    warnings.push(
      `Terminal value is ${terminalShare}% of enterprise value, so most of the answer comes from beyond the forecast window. Test the terminal assumptions harder than the forecast ones.`,
    );
  }
  if (equityValue <= 0) {
    warnings.push(
      'Equity value is zero or negative at these assumptions. Check the bridge inputs before reading anything into the per-share figure.',
    );
  }

  return {
    forecast,
    terminalValue: round2(terminalValue),
    presentValueTerminalValue: round2(presentValueTerminalValue),
    presentValueForecastCashFlows: round2(presentValueForecastCashFlows),
    enterpriseValue: round2(enterpriseValue),
    equityValue,
    intrinsicValuePerShare: round2(equityValue / shares),
    terminalValueShareOfEnterpriseValuePct: terminalShare,
    bridge: bridgeLines,
    wacc: waccBreakdown,
    warnings,
  };
}

/** Apply a scenario's driver overrides to a base assumption set. */
export function applyScenario(
  assumptions: ModelAssumptions,
  scenario: ScenarioDefinition,
): ModelAssumptions {
  const next: ModelAssumptions = { ...assumptions, ...scenario.overrides };
  // A scenario that moves WACC must move the rate the engine reads, which in
  // derived mode is the manual override being switched on for that run.
  if (scenario.overrides.waccPct !== undefined) {
    next.wacc = {
      ...(assumptions.wacc ?? DEFAULT_WACC_INPUTS),
      mode: 'manual',
      manualWaccPct: scenario.overrides.waccPct,
    };
  }
  return next;
}

export interface SensitivityCell {
  waccPct: number;
  terminalGrowthPct: number;
  valuePerShare: number | null;
  /** Populated when this combination cannot be valued. */
  error: string | null;
}

/** Implied value per share across a grid of discount and terminal growth rates. */
export function calculateSensitivity(
  historical: Array<HistoricalYear | EngineHistoricalYear>,
  assumptions: ModelAssumptions,
  axes: SensitivityAxes,
): SensitivityCell[][] {
  return axes.waccPct.map((waccPct) =>
    axes.terminalGrowthPct.map((terminalGrowthPct) => {
      try {
        const run = calculateDcf(historical, {
          ...assumptions,
          waccPct,
          terminalGrowthPct,
          wacc: { ...(assumptions.wacc ?? DEFAULT_WACC_INPUTS), mode: 'manual', manualWaccPct: waccPct },
        });
        return { waccPct, terminalGrowthPct, valuePerShare: run.intrinsicValuePerShare, error: null };
      } catch (error) {
        return {
          waccPct,
          terminalGrowthPct,
          valuePerShare: null,
          error: error instanceof Error ? error.message : 'This combination cannot be valued.',
        };
      }
    }),
  );
}

const croreFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const croreFormatter1 = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const rupeeFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

export function formatCrore(value: number): string {
  if (!FINITE(value)) return 'n/a';
  return croreFormatter.format(value);
}

export function formatCroreSigned(value: number): string {
  if (!FINITE(value)) return 'n/a';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${croreFormatter.format(Math.abs(value))}`;
}

export function formatPerShare(value: number): string {
  if (!FINITE(value)) return 'n/a';
  return rupeeFormatter.format(value);
}

export function formatPercent(value: number, digits = 1): string {
  if (!FINITE(value)) return 'n/a';
  return `${digits === 1 ? croreFormatter1.format(value) : value.toFixed(digits)}%`;
}
