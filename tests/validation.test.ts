/**
 * Validator tests.
 *
 * The shipped data file is validated here too, so a change to the seed script
 * that quietly breaks the schema fails the build rather than the deployment.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_PAYLOAD_BYTES, isValuationFile, sanitizeSnapshot, sanitizeText, validateSnapshot } from '../shared/validation';
import type { ValuationFile, ValuationSnapshot } from '../shared/types';

const file = JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/data/valuations.json'), 'utf8'),
) as ValuationFile;

const seed = file.snapshots[0];

/** A deep clone, so each test mutates its own copy. */
const clone = (): ValuationSnapshot => JSON.parse(JSON.stringify(seed)) as ValuationSnapshot;

const errorPaths = (snapshot: unknown) => validateSnapshot(snapshot).errors.map((issue) => issue.path);
const errorText = (snapshot: unknown) => validateSnapshot(snapshot).errors.map((issue) => issue.message).join(' | ');

describe('the shipped data file', () => {
  it('matches the file shape the server expects', () => {
    expect(isValuationFile(file)).toBe(true);
    expect(file.current).toBe(seed.id);
  });

  it('validates with no blocking problems', () => {
    const validation = validateSnapshot(seed);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
  });

  it('warns only that it is illustrative, because it is', () => {
    const validation = validateSnapshot(seed);
    expect(validation.warnings.map((issue) => issue.path)).toEqual(['dataStatus']);
  });

  it('is marked illustrative, so nothing invented is presented as reported data', () => {
    expect(seed.dataStatus).toBe('illustrative');
    const classifications = seed.historical.flatMap((row) =>
      Object.values(row.provenance ?? {}).map((entry) => entry?.classification),
    );
    expect(new Set(classifications)).toEqual(new Set(['assumption']));
  });

  it('stores results that follow from its own inputs', () => {
    expect(seed.results.equityValue).toBeCloseTo(
      seed.results.enterpriseValue - seed.assumptions.netDebtCrore,
      1,
    );
    expect(seed.results.intrinsicValuePerShare).toBeCloseTo(
      seed.results.equityValue / (seed.assumptions.bridge?.dilutedShares ?? 1),
      1,
    );
  });
});

describe('required figures', () => {
  it('rejects a missing revenue', () => {
    const snapshot = clone();
    delete (snapshot.historical[0] as unknown as Record<string, unknown>).revenue;
    expect(errorPaths(snapshot)).toContain('historical.0.revenue');
  });

  it('rejects a revenue of zero', () => {
    const snapshot = clone();
    snapshot.historical[0].revenue = 0;
    expect(errorPaths(snapshot)).toContain('historical.0.revenue');
  });

  it('rejects negative depreciation and capital expenditure', () => {
    const snapshot = clone();
    snapshot.historical[0].depreciation = -10;
    snapshot.historical[0].capex = -10;
    const paths = errorPaths(snapshot);
    expect(paths).toContain('historical.0.depreciation');
    expect(paths).toContain('historical.0.capex');
  });

  it('rejects a figure that looks like the wrong unit', () => {
    const snapshot = clone();
    snapshot.historical[0].revenue = 5e10;
    expect(errorText(snapshot)).toMatch(/Check the units/);
  });

  it('rejects a string where a number belongs', () => {
    const snapshot = clone();
    (snapshot.historical[0] as unknown as Record<string, unknown>).revenue = '40500';
    expect(errorText(snapshot)).toMatch(/must be a number/);
  });
});

describe('years', () => {
  it('rejects a financial year in the wrong format', () => {
    const snapshot = clone();
    snapshot.historical[0].year = '2021-22';
    expect(errorText(snapshot)).toMatch(/FY2024-25/);
  });

  it('rejects the same year twice', () => {
    const snapshot = clone();
    snapshot.historical[1].year = snapshot.historical[0].year;
    expect(errorText(snapshot)).toMatch(/only appear once/);
  });

  it('rejects years that are not oldest first', () => {
    const snapshot = clone();
    snapshot.historical.reverse();
    expect(errorText(snapshot)).toMatch(/oldest first/);
  });

  it('rejects more than 15 years', () => {
    const snapshot = clone();
    snapshot.historical = Array.from({ length: 16 }, (_, index) => ({
      ...snapshot.historical[0],
      year: `FY20${String(10 + index).padStart(2, '0')}-${String(11 + index).padStart(2, '0')}`,
    }));
    expect(errorText(snapshot)).toMatch(/at most 15 historical years/);
  });
});

describe('the schema is closed', () => {
  it('rejects an unexpected top-level key', () => {
    const snapshot = { ...clone(), injected: 'anything' };
    expect(errorText(snapshot)).toMatch(/not part of the snapshot schema/);
  });

  it('rejects an unexpected company key', () => {
    const snapshot = clone();
    (snapshot.company as unknown as Record<string, unknown>).secret = 'x';
    expect(errorPaths(snapshot)).toContain('company.secret');
  });

  it('rejects an unrecognised provenance line item', () => {
    const snapshot = clone();
    (snapshot.historical[0].provenance as unknown as Record<string, unknown>).madeUpLine = {
      sourceId: '', page: '', statement: '', unit: '', classification: 'reported', verification: 'verified',
    };
    expect(errorText(snapshot)).toMatch(/not a recognised line item/);
  });

  it('rejects a scenario override the model does not support', () => {
    const snapshot = clone();
    (snapshot.scenarios.bull.overrides as unknown as Record<string, unknown>).magicMultiple = 2;
    expect(errorText(snapshot)).toMatch(/cannot be overridden/);
  });

  it('rejects an unrecognised scenario', () => {
    const snapshot = clone();
    (snapshot.scenarios as unknown as Record<string, unknown>).moonshot = { label: 'x', notes: '', overrides: {} };
    expect(errorText(snapshot)).toMatch(/not a recognised scenario/);
  });
});

describe('sources and provenance', () => {
  it('rejects a reported figure with no source document', () => {
    const snapshot = clone();
    snapshot.historical[0].provenance.revenue = {
      sourceId: '', page: '12', statement: 'P&L', unit: 'INR crore',
      classification: 'reported', verification: 'verified',
    };
    expect(errorText(snapshot)).toMatch(/marked as reported but has no source/);
  });

  it('rejects a reference to a source that is not in the list', () => {
    const snapshot = clone();
    snapshot.historical[0].provenance.revenue = {
      sourceId: 'does-not-exist', page: '12', statement: 'P&L', unit: 'INR crore',
      classification: 'reported', verification: 'verified',
    };
    expect(errorText(snapshot)).toMatch(/is not in the source list/);
  });

  it('rejects a source link that is not http or https', () => {
    const snapshot = clone();
    snapshot.sources[0].url = 'javascript:alert(1)';
    expect(errorText(snapshot)).toMatch(/must start with http/);
  });

  it('rejects a duplicate source id', () => {
    const snapshot = clone();
    snapshot.sources.push({ ...snapshot.sources[0] });
    expect(errorText(snapshot)).toMatch(/used more than once/);
  });

  it('warns when a reported figure has no page number yet', () => {
    const snapshot = clone();
    snapshot.historical[0].provenance.revenue = {
      sourceId: snapshot.sources[0].id, page: '', statement: 'P&L', unit: 'INR crore',
      classification: 'reported', verification: 'cross-checked',
    };
    const warnings = validateSnapshot(snapshot).warnings.map((issue) => issue.message).join(' | ');
    expect(warnings).toMatch(/no page reference/);
  });
});

describe('verified research is gated on the source trail', () => {
  it('refuses to publish as verified while a reported figure is unchecked', () => {
    const snapshot = clone();
    snapshot.dataStatus = 'verified';
    snapshot.historical[0].provenance.revenue = {
      sourceId: snapshot.sources[0].id, page: '12', statement: 'P&L', unit: 'INR crore',
      classification: 'reported', verification: 'unverified',
    };
    expect(errorText(snapshot)).toMatch(/not verified, so this snapshot cannot be published as verified/);
  });

  it('refuses to publish as verified with no source trail at all', () => {
    const snapshot = clone();
    snapshot.dataStatus = 'verified';
    snapshot.historical = snapshot.historical.map((row) => ({ ...row, provenance: {} }));
    expect(errorText(snapshot)).toMatch(/carries no source trail/);
  });

  it('accepts verified once every reported figure is checked', () => {
    const snapshot = clone();
    snapshot.dataStatus = 'verified';
    snapshot.historical = snapshot.historical.map((row) => ({
      ...row,
      provenance: {
        revenue: {
          sourceId: snapshot.sources[0].id, page: '12', statement: 'P&L', unit: 'INR crore',
          classification: 'reported' as const, verification: 'verified' as const,
        },
      },
    }));
    expect(validateSnapshot(snapshot).errors).toEqual([]);
  });
});

describe('assumptions', () => {
  it('rejects a terminal growth rate at or above the discount rate', () => {
    const snapshot = clone();
    snapshot.assumptions.terminalGrowthPct = snapshot.assumptions.waccPct;
    expect(errorText(snapshot)).toMatch(/infinite value/);
  });

  it('rejects cost of capital weights that do not total 100%', () => {
    const snapshot = clone();
    snapshot.assumptions.wacc!.equityWeightPct = 80;
    snapshot.assumptions.wacc!.debtWeightPct = 10;
    expect(errorText(snapshot)).toMatch(/must total 100/);
  });

  it('allows weights that do not total 100% in manual mode, where they are unused', () => {
    const snapshot = clone();
    snapshot.assumptions.wacc!.mode = 'manual';
    snapshot.assumptions.wacc!.manualWaccPct = snapshot.assumptions.waccPct;
    snapshot.assumptions.wacc!.equityWeightPct = 80;
    snapshot.assumptions.wacc!.debtWeightPct = 10;
    expect(validateSnapshot(snapshot).errors).toEqual([]);
  });

  it('rejects a zero share count in the bridge', () => {
    const snapshot = clone();
    snapshot.assumptions.bridge!.dilutedShares = 0;
    expect(errorPaths(snapshot)).toContain('assumptions.bridge.dilutedShares');
  });

  it('rejects a lease treatment it does not recognise', () => {
    const snapshot = clone();
    (snapshot.assumptions.bridge as unknown as Record<string, unknown>).leaseTreatment = 'ignored';
    expect(errorPaths(snapshot)).toContain('assumptions.bridge.leaseTreatment');
  });

  it('rejects a forecast period that is not a whole number', () => {
    const snapshot = clone();
    snapshot.assumptions.forecastYears = 5.5;
    expect(errorText(snapshot)).toMatch(/whole number of years/);
  });

  it('rejects a sensitivity axis that is not ascending', () => {
    const snapshot = clone();
    snapshot.sensitivity.waccPct = [12, 9, 10];
    expect(errorText(snapshot)).toMatch(/low to high/);
  });

  it('rejects a sensitivity axis with one value', () => {
    const snapshot = clone();
    snapshot.sensitivity.terminalGrowthPct = [4];
    expect(errorText(snapshot)).toMatch(/between 2 and 9/);
  });
});

describe('reconciliation produces warnings, not blocks', () => {
  it('flags EBITDA that does not reconcile to EBIT', () => {
    const snapshot = clone();
    snapshot.historical[0].ebitda = 99999;
    const validation = validateSnapshot(snapshot);
    expect(validation.ok).toBe(true);
    expect(validation.warnings.map((issue) => issue.message).join(' ')).toMatch(/EBITDA less depreciation/);
  });

  it('flags operating expenses that do not reconcile to EBIT', () => {
    const snapshot = clone();
    snapshot.historical[0].operatingExpenses = 1;
    expect(validateSnapshot(snapshot).warnings.map((issue) => issue.message).join(' ')).toMatch(
      /less operating expenses/,
    );
  });

  it('flags profit before tax that does not reconcile', () => {
    const snapshot = clone();
    snapshot.historical[0].profitBeforeTax = 1;
    expect(validateSnapshot(snapshot).warnings.map((issue) => issue.message).join(' ')).toMatch(
      /less finance costs/,
    );
  });

  it('flags a bridge cash figure that disagrees with the latest balance sheet', () => {
    const snapshot = clone();
    snapshot.assumptions.bridge!.cashAndEquivalents = 9000;
    expect(validateSnapshot(snapshot).warnings.map((issue) => issue.message).join(' ')).toMatch(/Cash in the bridge/);
  });

  it('flags a share count in the bridge that disagrees with the reported one', () => {
    const snapshot = clone();
    snapshot.assumptions.bridge!.dilutedShares = 200;
    expect(validateSnapshot(snapshot).warnings.map((issue) => issue.message).join(' ')).toMatch(
      /Diluted shares in the bridge/,
    );
  });

  it('flags a negative operating profit year', () => {
    const snapshot = clone();
    snapshot.historical[0].ebit = -100;
    snapshot.historical[0].ebitda = null;
    snapshot.historical[0].operatingExpenses = null;
    snapshot.historical[0].profitBeforeTax = null;
    expect(validateSnapshot(snapshot).warnings.map((issue) => issue.message).join(' ')).toMatch(/EBIT is negative/);
  });
});

describe('model failures are reported as errors', () => {
  it('surfaces the engine message when the assumptions cannot be valued', () => {
    const snapshot = clone();
    snapshot.assumptions.capexPctRevenue = 90;
    expect(errorText(snapshot)).toMatch(/zero or negative/);
  });
});

describe('text handling', () => {
  it('strips control characters and trims', () => {
    expect(sanitizeText('  a\u0000b\u0007c  ', 100)).toBe('abc');
  });

  it('caps length', () => {
    expect(sanitizeText('x'.repeat(50), 10)).toHaveLength(10);
  });

  it('normalises line endings and collapses runs of blank lines', () => {
    expect(sanitizeText('a\r\n\n\n\n\nb', 100)).toBe('a\n\n\nb');
  });

  it('returns an empty string for anything that is not a string', () => {
    expect(sanitizeText(42, 10)).toBe('');
    expect(sanitizeText(null, 10)).toBe('');
  });

  it('leaves ordinary text alone, since escaping happens at render time', () => {
    const text = 'Revenue grew 8% & margins held <steady>';
    expect(sanitizeText(text, 200)).toBe(text);
  });

  it('sanitises a whole snapshot without changing its figures', () => {
    const snapshot = clone();
    snapshot.company.researchNotes = ` notes\u0000 `;
    const cleaned = sanitizeSnapshot(snapshot);
    expect(cleaned.company.researchNotes).toBe('notes');
    expect(cleaned.historical[0].revenue).toBe(snapshot.historical[0].revenue);
  });
});

describe('file shape guard', () => {
  it('rejects anything that is not a valuation file', () => {
    expect(isValuationFile(null)).toBe(false);
    expect(isValuationFile([])).toBe(false);
    expect(isValuationFile({ schemaVersion: 2, current: 'x' })).toBe(false);
    expect(isValuationFile({ schemaVersion: '2', current: 'x', snapshots: [] })).toBe(false);
    expect(isValuationFile({ schemaVersion: 2, current: 'x', snapshots: [{}] })).toBe(false);
  });

  it('accepts an empty but well-formed file', () => {
    expect(isValuationFile({ schemaVersion: 2, current: '', snapshots: [], generatedAt: '' })).toBe(true);
  });
});

describe('payload ceiling', () => {
  it('is set, so an unbounded body cannot be parsed', () => {
    expect(MAX_PAYLOAD_BYTES).toBeGreaterThan(0);
    expect(MAX_PAYLOAD_BYTES).toBeLessThanOrEqual(1024 * 1024);
  });
});
