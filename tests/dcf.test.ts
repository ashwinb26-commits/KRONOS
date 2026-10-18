/**
 * Engine tests.
 *
 * The first case is small enough to work out by hand, so the expectations are
 * independent of the implementation rather than a snapshot of whatever it
 * happens to produce.
 */

import { describe, expect, it } from 'vitest';
import {
  DcfError,
  buildEquityBridge,
  calculateDcf,
  calculateSensitivity,
  calculateWacc,
  deriveOperatingNwc,
  effectiveWaccPct,
  nextFinancialYearLabel,
  toEngineHistory,
} from '../shared/dcf';
import type { EngineHistoricalYear, HistoricalYear, ModelAssumptions } from '../shared/types';

const baseHistory: EngineHistoricalYear[] = [
  { year: 'FY2024-25', revenue: 1000, ebit: 200, depreciation: 50, capex: 60, operatingNwc: 100 },
];

const baseAssumptions: ModelAssumptions = {
  revenueGrowthPct: 10,
  ebitMarginPct: 20,
  taxRatePct: 25,
  depreciationPctRevenue: 5,
  capexPctRevenue: 6,
  nwcPctIncrementalRevenue: 20,
  waccPct: 10,
  terminalGrowthPct: 0,
  netDebtCrore: 0,
  dilutedSharesCrore: 10,
};

describe('calculateDcf, worked out by hand', () => {
  /*
   * Year 1 from a 1000 revenue base:
   *   revenue           1000 x 1.10        = 1100
   *   EBIT              1100 x 20%         =  220
   *   tax               220 x 25%          =   55
   *   NOPAT                                =  165
   *   depreciation      1100 x 5%           =   55
   *   capex             1100 x 6%           =   66
   *   change in NWC     (1100 - 1000) x 20% =   20
   *   FCFF              165 + 55 - 66 - 20  =  134
   *   discount factor   1 / 1.10            = 0.909091
   *   PV of FCFF        134 x 0.909091      = 121.82
   *   terminal value    134 x 1.00 / 0.10   = 1340
   *   PV of terminal    1340 / 1.10         = 1218.18
   *   enterprise value  121.82 + 1218.18    = 1340.00
   */
  const result = calculateDcf(baseHistory, baseAssumptions, 1);
  const year = result.forecast[0];

  it('rolls revenue forward at the growth driver', () => {
    expect(year.revenue).toBe(1100);
  });

  it('takes EBIT off the margin driver', () => {
    expect(year.ebit).toBe(220);
  });

  it('charges tax on EBIT and reports net operating profit after tax', () => {
    expect(year.taxesOnEbit).toBe(55);
    expect(year.nopat).toBe(165);
  });

  it('builds free cash flow from NOPAT, depreciation, capex and working capital', () => {
    expect(year.depreciation).toBe(55);
    expect(year.capex).toBe(66);
    expect(year.changeInNwc).toBe(20);
    expect(year.fcff).toBe(134);
  });

  it('discounts the first year by one period', () => {
    expect(year.discountFactor).toBeCloseTo(0.9091, 4);
    expect(year.presentValueFcff).toBe(121.82);
  });

  it('values the perpetuity and discounts it over the forecast period', () => {
    expect(result.terminalValue).toBe(1340);
    expect(result.presentValueTerminalValue).toBe(1218.18);
  });

  it('adds the two to reach enterprise value', () => {
    expect(result.enterpriseValue).toBe(1340);
    expect(result.presentValueForecastCashFlows).toBe(121.82);
  });

  it('reports the terminal value share of enterprise value', () => {
    expect(result.terminalValueShareOfEnterpriseValuePct).toBeCloseTo(90.91, 2);
  });

  it('divides equity value by the share count', () => {
    expect(result.equityValue).toBe(1340);
    expect(result.intrinsicValuePerShare).toBe(134);
  });

  it('warns when the terminal value dominates', () => {
    expect(result.warnings.join(' ')).toMatch(/Terminal value is/);
  });
});

describe('calculateDcf, internal consistency over 5 years', () => {
  const result = calculateDcf(baseHistory, baseAssumptions, 5);

  it('has enterprise value equal to the discounted cash flows plus the discounted terminal value', () => {
    const sum = result.forecast.reduce((total, row) => total + row.presentValueFcff, 0);
    expect(sum + result.presentValueTerminalValue).toBeCloseTo(result.enterpriseValue, 2);
    expect(sum).toBeCloseTo(result.presentValueForecastCashFlows, 2);
  });

  it('compounds the discount factor one period per year', () => {
    result.forecast.forEach((row, index) => {
      expect(row.discountFactor).toBeCloseTo(1 / 1.1 ** (index + 1), 4);
    });
  });

  it('ends the bridge on the same figure it reports as equity value', () => {
    const last = result.bridge[result.bridge.length - 1];
    expect(last.key).toBe('equityValue');
    expect(last.runningTotal).toBe(result.equityValue);
  });
});

describe('year labels', () => {
  it('advances an Indian financial year label', () => {
    expect(nextFinancialYearLabel('FY2024-25')).toBe('FY2025-26');
    expect(nextFinancialYearLabel('FY2099-00')).toBe('FY2100-01');
  });

  it('returns null for a label it does not recognise', () => {
    expect(nextFinancialYearLabel('2024')).toBeNull();
  });

  it('labels the forecast from the last reported year', () => {
    const result = calculateDcf(baseHistory, baseAssumptions, 2);
    expect(result.forecast.map((row) => row.year)).toEqual(['FY2025-26', 'FY2026-27']);
  });

  it('honours an explicit first forecast year', () => {
    const result = calculateDcf(baseHistory, { ...baseAssumptions, firstForecastYearLabel: 'FY2030-31' }, 2);
    expect(result.forecast.map((row) => row.year)).toEqual(['FY2030-31', 'FY2031-32']);
  });
});

describe('invalid assumptions raise rather than returning a wrong number', () => {
  it('refuses a terminal growth rate at or above the discount rate', () => {
    expect(() => calculateDcf(baseHistory, { ...baseAssumptions, terminalGrowthPct: 10 })).toThrow(DcfError);
    try {
      calculateDcf(baseHistory, { ...baseAssumptions, terminalGrowthPct: 12 });
    } catch (error) {
      expect((error as DcfError).code).toBe('terminal_growth');
    }
  });

  it('refuses a zero or negative share count', () => {
    expect(() => calculateDcf(baseHistory, { ...baseAssumptions, dilutedSharesCrore: 0 })).toThrow(/greater than zero/);
  });

  it('refuses an empty history', () => {
    expect(() => calculateDcf([], baseAssumptions)).toThrow(/at least one historical year/i);
  });

  it('refuses a non-positive base revenue', () => {
    expect(() =>
      calculateDcf([{ ...baseHistory[0], revenue: 0 }], baseAssumptions),
    ).toThrow(/positive revenue/);
  });

  it('refuses a forecast period outside 1 to 15 years', () => {
    expect(() => calculateDcf(baseHistory, baseAssumptions, 0)).toThrow(/1 to 15/);
    expect(() => calculateDcf(baseHistory, baseAssumptions, 16)).toThrow(/1 to 15/);
  });

  it('refuses to value a perpetuity on negative final cash flow', () => {
    expect(() =>
      calculateDcf(baseHistory, { ...baseAssumptions, capexPctRevenue: 95 }, 1),
    ).toThrow(/zero or negative/);
  });
});

describe('per-year overrides', () => {
  it('takes precedence over the flat driver, and falls back where null', () => {
    const result = calculateDcf(
      baseHistory,
      { ...baseAssumptions, perYear: { revenueGrowthPct: [0, null, 50] } },
      3,
    );
    expect(result.forecast[0].revenue).toBe(1000);
    expect(result.forecast[1].revenue).toBe(1100);
    expect(result.forecast[2].revenue).toBe(1650);
  });

  it('applies a margin path year by year', () => {
    const result = calculateDcf(
      baseHistory,
      { ...baseAssumptions, perYear: { ebitMarginPct: [10, 30] } },
      2,
    );
    expect(result.forecast[0].ebitMarginPct).toBe(10);
    expect(result.forecast[1].ebitMarginPct).toBe(30);
  });
});

describe('capital expenditure and working capital methods', () => {
  it('can charge capital expenditure on additional revenue only', () => {
    const result = calculateDcf(
      baseHistory,
      { ...baseAssumptions, capexMethod: 'pctIncrementalRevenue' },
      1,
    );
    // 6% of the 100 of additional revenue, not 6% of 1100.
    expect(result.forecast[0].capex).toBe(6);
  });

  it('can hold working capital at a share of total revenue', () => {
    const result = calculateDcf(baseHistory, { ...baseAssumptions, nwcMethod: 'pctRevenue' }, 1);
    // 20% of 1100 less 20% of 1000.
    expect(result.forecast[0].changeInNwc).toBe(20);
  });
});

describe('mid-year discounting', () => {
  it('discounts the first year by half a period', () => {
    const result = calculateDcf(baseHistory, { ...baseAssumptions, midYearConvention: true }, 1);
    expect(result.forecast[0].discountFactor).toBeCloseTo(1 / 1.1 ** 0.5, 4);
  });

  it('produces a higher value than end-of-year discounting', () => {
    const endOfYear = calculateDcf(baseHistory, baseAssumptions, 5);
    const midYear = calculateDcf(baseHistory, { ...baseAssumptions, midYearConvention: true }, 5);
    expect(midYear.enterpriseValue).toBeGreaterThan(endOfYear.enterpriseValue);
  });
});

describe('calculateWacc', () => {
  it('builds the rate from its components', () => {
    // Cost of equity 7 + 1.2 x 5.5 + 0.5 = 14.1
    // Cost of debt after tax 9 x (1 - 0.30) = 6.3
    // WACC 0.70 x 14.1 + 0.30 x 6.3 = 11.76
    const breakdown = calculateWacc({
      mode: 'derived',
      riskFreeRatePct: 7,
      betaLevered: 1.2,
      equityRiskPremiumPct: 5.5,
      additionalEquityPremiumPct: 0.5,
      costOfDebtPreTaxPct: 9,
      marginalTaxRatePct: 30,
      equityWeightPct: 70,
      debtWeightPct: 30,
      manualWaccPct: 99,
    });
    expect(breakdown.costOfEquityPct).toBeCloseTo(14.1, 4);
    expect(breakdown.costOfDebtAfterTaxPct).toBeCloseTo(6.3, 4);
    expect(breakdown.waccPct).toBeCloseTo(11.76, 4);
  });

  it('refuses weights that do not total 100%', () => {
    expect(() =>
      calculateWacc({
        mode: 'derived',
        riskFreeRatePct: 7,
        betaLevered: 1,
        equityRiskPremiumPct: 5,
        additionalEquityPremiumPct: 0,
        costOfDebtPreTaxPct: 8,
        marginalTaxRatePct: 25,
        equityWeightPct: 70,
        debtWeightPct: 20,
        manualWaccPct: 10,
      }),
    ).toThrow(/must total 100/);
  });

  it('uses the single rate in manual mode and still reports the components', () => {
    const breakdown = calculateWacc({
      mode: 'manual',
      riskFreeRatePct: 7,
      betaLevered: 1,
      equityRiskPremiumPct: 5,
      additionalEquityPremiumPct: 0,
      costOfDebtPreTaxPct: 8,
      marginalTaxRatePct: 25,
      equityWeightPct: 70,
      debtWeightPct: 20,
      manualWaccPct: 13.5,
    });
    expect(breakdown.waccPct).toBe(13.5);
    expect(breakdown.costOfEquityPct).toBe(12);
  });

  it('is what the engine discounts at', () => {
    const assumptions: ModelAssumptions = {
      ...baseAssumptions,
      waccPct: 99,
      wacc: {
        mode: 'manual',
        riskFreeRatePct: 7,
        betaLevered: 1,
        equityRiskPremiumPct: 5,
        additionalEquityPremiumPct: 0,
        costOfDebtPreTaxPct: 8,
        marginalTaxRatePct: 25,
        equityWeightPct: 100,
        debtWeightPct: 0,
        manualWaccPct: 10,
      },
    };
    expect(effectiveWaccPct(assumptions)).toBe(10);
    const result = calculateDcf(baseHistory, assumptions, 1);
    expect(result.wacc.waccPct).toBe(10);
    expect(result.forecast[0].discountFactor).toBeCloseTo(1 / 1.1, 4);
  });
});

describe('buildEquityBridge', () => {
  const bridge = {
    grossDebt: 200,
    leaseLiabilities: 50,
    leasesIncludedInGrossDebt: false,
    leaseTreatment: 'capitalised' as const,
    cashAndEquivalents: 80,
    nonOperatingInvestments: 20,
    nonControllingInterests: 30,
    otherClaims: 10,
    dilutedShares: 10,
  };

  it('deducts every claim once and adds back cash and investments', () => {
    // 1000 - 200 - 50 - 30 - 10 + 80 + 20 = 810
    const built = buildEquityBridge(1000, bridge);
    expect(built.equityValue).toBe(810);
    expect(built.warnings).toHaveLength(0);
  });

  it('does not deduct leases that are already inside gross debt', () => {
    const built = buildEquityBridge(1000, { ...bridge, leasesIncludedInGrossDebt: true });
    expect(built.equityValue).toBe(860);
    expect(built.warnings.join(' ')).toMatch(/already inside gross debt/);
  });

  it('does not deduct leases when lease costs sit inside operating profit', () => {
    const built = buildEquityBridge(1000, { ...bridge, leaseTreatment: 'expensed' });
    expect(built.equityValue).toBe(860);
    expect(built.warnings.join(' ')).toMatch(/same obligation twice/);
  });

  it('omits lines that are zero rather than printing empty rows', () => {
    const built = buildEquityBridge(1000, {
      ...bridge,
      leaseLiabilities: 0,
      nonControllingInterests: 0,
      otherClaims: 0,
      nonOperatingInvestments: 0,
    });
    expect(built.lines.map((line) => line.key)).toEqual([
      'enterpriseValue',
      'grossDebt',
      'cashAndEquivalents',
      'equityValue',
    ]);
  });

  it('keeps a running total that matches the final equity value', () => {
    const built = buildEquityBridge(1000, bridge);
    const last = built.lines[built.lines.length - 1];
    expect(last.runningTotal).toBe(built.equityValue);
  });

  it('is what the engine uses when a bridge is present', () => {
    const result = calculateDcf(baseHistory, { ...baseAssumptions, netDebtCrore: 9999, bridge }, 1);
    expect(result.equityValue).toBe(1340 - 200 - 50 - 30 - 10 + 80 + 20);
    expect(result.intrinsicValuePerShare).toBe(result.equityValue / 10);
  });

  it('falls back to the single net debt figure when there is no bridge', () => {
    const result = calculateDcf(baseHistory, { ...baseAssumptions, netDebtCrore: 340 }, 1);
    expect(result.equityValue).toBe(1000);
    expect(result.bridge.map((line) => line.key)).toEqual(['enterpriseValue', 'netDebt', 'equityValue']);
  });
});

describe('operating working capital', () => {
  const row: HistoricalYear = {
    year: 'FY2024-25',
    revenue: 1000,
    operatingExpenses: null,
    ebitda: null,
    depreciation: 50,
    ebit: 200,
    financeCosts: null,
    profitBeforeTax: null,
    taxExpense: null,
    netProfit: null,
    cashAndEquivalents: 500,
    borrowings: 300,
    receivables: 120,
    inventories: 180,
    tradePayables: 90,
    propertyPlantEquipment: null,
    otherOperatingAssets: 30,
    otherOperatingLiabilities: 40,
    leaseLiabilities: null,
    nonControllingInterests: null,
    nonOperatingInvestments: null,
    operatingCashFlow: null,
    capex: 60,
    changeInWorkingCapital: null,
    otherInvestingItems: null,
    dilutedShares: 10,
    operatingNwc: null,
    provenance: {},
  };

  it('derives from the operating balance sheet lines, excluding cash and debt', () => {
    // 120 + 180 + 30 - 90 - 40 = 200
    expect(deriveOperatingNwc(row)).toBe(200);
  });

  it('uses an explicit override when one is entered', () => {
    expect(deriveOperatingNwc({ ...row, operatingNwc: 555 })).toBe(555);
  });

  it('reduces a full reported year to what the engine reads', () => {
    expect(toEngineHistory([row])[0]).toEqual({
      year: 'FY2024-25',
      revenue: 1000,
      ebit: 200,
      depreciation: 50,
      capex: 60,
      operatingNwc: 200,
    });
  });
});

describe('calculateSensitivity', () => {
  const grid = calculateSensitivity(baseHistory, baseAssumptions, {
    waccPct: [8, 10, 12],
    terminalGrowthPct: [0, 2, 12],
  });

  it('returns a cell for every combination', () => {
    expect(grid).toHaveLength(3);
    expect(grid[0]).toHaveLength(3);
  });

  it('values falls as the discount rate rises', () => {
    const atZeroGrowth = grid.map((row) => row[0].valuePerShare as number);
    expect(atZeroGrowth[0]).toBeGreaterThan(atZeroGrowth[1]);
    expect(atZeroGrowth[1]).toBeGreaterThan(atZeroGrowth[2]);
  });

  it('reports combinations it cannot value instead of printing a number', () => {
    const impossible = grid[0][2];
    expect(impossible.valuePerShare).toBeNull();
    expect(impossible.error).toMatch(/terminal growth/i);
  });
});
