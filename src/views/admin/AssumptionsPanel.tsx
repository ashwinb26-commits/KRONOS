/**
 * Forecast assumptions and the cost of capital.
 *
 * The flat driver applies to every forecast year. The override table below it
 * takes precedence for any year it has a figure in, which is how a tapering
 * growth path gets built without a second model.
 */

import type { ModelAssumptions, PerYearDriverKey, ValuationSnapshot } from '../../../shared/types';
import { DEFAULT_WACC_INPUTS, calculateWacc } from '../../../shared/dcf';
import {
  Banner,
  Button,
  CheckboxField,
  DriverControl,
  NumberField,
  SelectField,
  TableFrame,
  TextAreaField,
  TextField,
} from '../../components/ui';
import { formatPercent } from '../../lib/format';

const DRIVERS: Array<{
  key: PerYearDriverKey;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  hint: string;
}> = [
  {
    key: 'revenueGrowthPct',
    label: 'Revenue growth',
    min: -20, max: 30, step: 0.25, unit: '%',
    hint: 'Year on year growth applied to the previous year’s revenue.',
  },
  {
    key: 'ebitMarginPct',
    label: 'Operating margin',
    min: 0, max: 40, step: 0.25, unit: '%',
    hint: 'Operating profit as a share of revenue, after depreciation.',
  },
  {
    key: 'taxRatePct',
    label: 'Operating tax rate',
    min: 0, max: 50, step: 0.25, unit: '%',
    hint: 'Effective rate charged on positive operating profit.',
  },
  {
    key: 'depreciationPctRevenue',
    label: 'Depreciation and amortisation',
    min: 0, max: 20, step: 0.1, unit: '%',
    hint: 'As a share of revenue. Compare it against the historical ratio before changing it.',
  },
  {
    key: 'capexPctRevenue',
    label: 'Capital expenditure',
    min: 0, max: 40, step: 0.25, unit: '%',
    hint: 'As a share of revenue, or of incremental revenue if that method is selected below.',
  },
  {
    key: 'nwcPctIncrementalRevenue',
    label: 'Working capital',
    min: -50, max: 60, step: 0.5, unit: '%',
    hint: 'Extra operating working capital needed per rupee of additional revenue.',
  },
];

export function AssumptionsPanel({
  draft,
  onChange,
}: {
  draft: ValuationSnapshot;
  onChange: (next: ValuationSnapshot) => void;
}) {
  const assumptions = draft.assumptions;
  const forecastYears = assumptions.forecastYears ?? 5;
  const wacc = assumptions.wacc ?? { ...DEFAULT_WACC_INPUTS, manualWaccPct: assumptions.waccPct };

  const setAssumptions = (patch: Partial<ModelAssumptions>) =>
    onChange({ ...draft, assumptions: { ...assumptions, ...patch } });

  const setWacc = (patch: Partial<typeof wacc>) => {
    const next = { ...wacc, ...patch };
    let derived = assumptions.waccPct;
    try {
      derived = calculateWacc(next).waccPct;
    } catch {
      // Weights that do not add up are reported by the validator rather than
      // here, so the analyst can finish typing the second weight.
    }
    setAssumptions({ wacc: next, waccPct: derived });
  };

  const setPerYear = (key: PerYearDriverKey, index: number, value: number | null) => {
    const series = [...(assumptions.perYear?.[key] ?? [])];
    while (series.length < forecastYears) series.push(null);
    series[index] = value;
    const perYear = { ...(assumptions.perYear ?? {}), [key]: series.slice(0, forecastYears) };
    setAssumptions({ perYear });
  };

  /**
   * How many forecast years carry their own value for a driver.
   *
   * This matters more than it looks: a driver whose every year is overridden
   * has no effect at all, and without saying so the slider moves and nothing
   * happens, which reads as a broken control rather than a deliberate one.
   */
  const overriddenYears = (key: PerYearDriverKey): number => {
    const series = assumptions.perYear?.[key] ?? [];
    return series
      .slice(0, forecastYears)
      .filter((value) => value !== null && value !== undefined && Number.isFinite(value)).length;
  };

  const clearOverrides = (key: PerYearDriverKey) => {
    const perYear = { ...(assumptions.perYear ?? {}) };
    delete perYear[key];
    setAssumptions({ perYear });
  };

  const forecastLabels = Array.from({ length: forecastYears }, (_, index) => `Year ${index + 1}`);
  let waccError: string | null = null;
  try {
    calculateWacc(wacc);
  } catch (error) {
    waccError = error instanceof Error ? error.message : 'The cost of capital could not be worked out.';
  }

  return (
    <div className="stack-6">
      <section className="panel">
        <div className="panel-head">
          <h3>Forecast drivers</h3>
          <span className="text-meta">Applied to every forecast year unless overridden below</span>
        </div>
        <div className="panel-pad">
          {DRIVERS.map((driver) => {
            const overridden = overriddenYears(driver.key);
            return (
              <DriverControl
                key={driver.key}
                label={driver.label}
                value={assumptions[driver.key]}
                min={driver.min}
                max={driver.max}
                step={driver.step}
                unit={driver.unit}
                hint={driver.hint}
                note={
                  overridden === 0 ? null : overridden >= forecastYears ? (
                    <>
                      <span>
                        Every forecast year has its own value in the override table below, so this driver is not
                        used.
                      </span>
                      <Button variant="quiet" onClick={() => clearOverrides(driver.key)}>
                        Clear year overrides
                      </Button>
                    </>
                  ) : (
                    <span>
                      {overridden} of {forecastYears} forecast years use their own value below. This driver applies to
                      the rest.
                    </span>
                  )
                }
                onChange={(value) => setAssumptions({ [driver.key]: value } as Partial<ModelAssumptions>)}
              />
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Forecast shape</h3>
        </div>
        <div className="panel-pad stack-4">
          <div className="field-row">
            <NumberField
              label="Forecast period"
              unit="years"
              value={forecastYears}
              min={1}
              max={15}
              step={1}
              onChange={(value) => setAssumptions({ forecastYears: value ?? 5 })}
              hint="Long enough for the business to reach a steady state, which is usually 5 to 10 years."
            />
            <TextField
              label="First forecast year"
              value={assumptions.firstForecastYearLabel ?? ''}
              onChange={(firstForecastYearLabel) => setAssumptions({ firstForecastYearLabel })}
              placeholder="FY2026-27"
              hint="The year after the last reported one. Leave empty to carry on from the history automatically."
              maxLength={12}
              validate={(value) =>
                value.trim() === '' || /^FY\d{4}-\d{2}$/.test(value.trim())
                  ? null
                  : 'Write the year as FY2026-27, or leave it empty.'
              }
            />
          </div>
          <div className="field-row">
            <SelectField
              label="Capital expenditure method"
              value={assumptions.capexMethod ?? 'pctRevenue'}
              options={[
                { value: 'pctRevenue', label: 'Percentage of revenue' },
                { value: 'pctIncrementalRevenue', label: 'Percentage of additional revenue' },
              ]}
              onChange={(capexMethod) => setAssumptions({ capexMethod })}
              hint="Percentage of revenue covers maintenance and growth together. Percentage of additional revenue treats it as growth capital only."
            />
            <SelectField
              label="Working capital method"
              value={assumptions.nwcMethod ?? 'pctIncrementalRevenue'}
              options={[
                { value: 'pctIncrementalRevenue', label: 'Percentage of additional revenue' },
                { value: 'pctRevenue', label: 'Percentage of total revenue' },
              ]}
              onChange={(nwcMethod) => setAssumptions({ nwcMethod })}
            />
          </div>
          <CheckboxField
            label="Discount cash flows from the middle of each year"
            hint="Cash arrives through the year rather than all on the last day, so mid-year discounting is usually the more realistic choice. It raises the valuation slightly."
            checked={assumptions.midYearConvention === true}
            onChange={(midYearConvention) => setAssumptions({ midYearConvention })}
          />
        </div>
      </section>

      <TableFrame
        title="Year by year overrides"
        footnote={
          <>
            An empty cell falls back to the flat driver above. This is where a tapering growth path or a margin that
            improves then settles gets written down.
          </>
        }
      >
        <table className="sheet" style={{ minWidth: 680 }}>
          <caption className="visually-hidden">Driver overrides by forecast year</caption>
          <thead>
            <tr>
              <th scope="col">Driver</th>
              {forecastLabels.map((label) => (
                <th scope="col" key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DRIVERS.map((driver) => (
              <tr key={driver.key}>
                <th scope="row">
                  {driver.label}
                  <span className="text-meta" style={{ display: 'block' }}>
                    flat driver {formatPercent(assumptions[driver.key], 2)}
                  </span>
                </th>
                {forecastLabels.map((label, index) => {
                  const series = assumptions.perYear?.[driver.key] ?? [];
                  const value = series[index];
                  return (
                    <td key={`${driver.key}-${label}`}>
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`${driver.label} override for ${label}`}
                        value={value === null || value === undefined ? '' : String(value)}
                        onChange={(event) => {
                          const raw = event.target.value.trim();
                          if (raw === '') {
                            setPerYear(driver.key, index, null);
                            return;
                          }
                          const parsed = Number(raw);
                          if (Number.isFinite(parsed)) setPerYear(driver.key, index, parsed);
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>

      <section className="panel">
        <div className="panel-head">
          <h3>Cost of capital</h3>
          <span className="text-meta">
            {wacc.mode === 'derived' ? 'Derived from the components below' : 'Assumed directly'}
          </span>
        </div>
        <div className="panel-pad stack-4">
          <SelectField
            label="How the discount rate is set"
            value={wacc.mode}
            options={[
              { value: 'derived', label: 'Build it from risk-free rate, beta and weights' },
              { value: 'manual', label: 'Assume a single rate directly' },
            ]}
            onChange={(mode) => setWacc({ mode })}
            hint="Building it up means each input can be argued with separately, and dated."
          />

          {waccError ? <Banner tone="error" title="The cost of capital does not add up">{waccError}</Banner> : null}

          {wacc.mode === 'manual' ? (
            <NumberField
              label="Weighted average cost of capital"
              unit="%"
              value={wacc.manualWaccPct}
              min={0.01}
              max={60}
              step={0.25}
              onChange={(value) => setWacc({ manualWaccPct: value ?? 10 })}
              hint="Record where this number came from in the research notes."
            />
          ) : (
            <>
              <div className="field-row">
                <NumberField
                  label="Risk-free rate" unit="%" value={wacc.riskFreeRatePct}
                  min={0} max={30} step={0.1}
                  onChange={(value) => setWacc({ riskFreeRatePct: value ?? 0 })}
                  hint="A long-dated government bond yield, with the date it was observed noted."
                />
                <NumberField
                  label="Levered beta" value={wacc.betaLevered}
                  min={0} max={5} step={0.05}
                  onChange={(value) => setWacc({ betaLevered: value ?? 1 })}
                  hint="Record the window and index used."
                />
              </div>
              <div className="field-row">
                <NumberField
                  label="Equity risk premium" unit="%" value={wacc.equityRiskPremiumPct}
                  min={0} max={20} step={0.1}
                  onChange={(value) => setWacc({ equityRiskPremiumPct: value ?? 0 })}
                />
                <NumberField
                  label="Additional equity premium" unit="%" value={wacc.additionalEquityPremiumPct}
                  min={0} max={20} step={0.1}
                  onChange={(value) => setWacc({ additionalEquityPremiumPct: value ?? 0 })}
                  hint="Any documented size or country add-on. Leave at 0 if there is none."
                />
              </div>
              <div className="field-row">
                <NumberField
                  label="Cost of debt before tax" unit="%" value={wacc.costOfDebtPreTaxPct}
                  min={0} max={30} step={0.1}
                  onChange={(value) => setWacc({ costOfDebtPreTaxPct: value ?? 0 })}
                />
                <NumberField
                  label="Marginal tax rate" unit="%" value={wacc.marginalTaxRatePct}
                  min={0} max={60} step={0.5}
                  onChange={(value) => setWacc({ marginalTaxRatePct: value ?? 0 })}
                  hint="Used for the interest tax shield, so it can differ from the operating rate."
                />
              </div>
              <div className="field-row">
                <NumberField
                  label="Equity weight" unit="%" value={wacc.equityWeightPct}
                  min={0} max={100} step={1}
                  onChange={(value) => setWacc({ equityWeightPct: value ?? 0, debtWeightPct: 100 - (value ?? 0) })}
                  hint="The debt weight follows automatically so the two always total 100%."
                />
                <NumberField
                  label="Debt weight" unit="%" value={wacc.debtWeightPct}
                  min={0} max={100} step={1}
                  onChange={(value) => setWacc({ debtWeightPct: value ?? 0, equityWeightPct: 100 - (value ?? 0) })}
                  hint="Market value weights where available."
                />
              </div>
              {!waccError ? (
                <Banner tone="ok" title={`Cost of capital works out at ${formatPercent(calculateWacc(wacc).waccPct, 2)}`}>
                  Cost of equity {formatPercent(calculateWacc(wacc).costOfEquityPct, 2)}, cost of debt after tax{' '}
                  {formatPercent(calculateWacc(wacc).costOfDebtAfterTaxPct, 2)}.
                </Banner>
              ) : null}
            </>
          )}

          <NumberField
            label="Terminal growth rate"
            unit="%"
            value={assumptions.terminalGrowthPct}
            min={-10}
            max={20}
            step={0.25}
            onChange={(value) => setAssumptions({ terminalGrowthPct: value ?? 0 })}
            hint="Has to stay below the discount rate, and should not exceed long-run nominal economic growth without a reason."
          />
        </div>
      </section>

      <ScenarioEditor draft={draft} onChange={onChange} />
      <SensitivityEditor draft={draft} onChange={onChange} />
    </div>
  );
}

const SCENARIO_OVERRIDE_FIELDS: Array<{ key: keyof ModelAssumptions & string; label: string; min: number; max: number }> = [
  { key: 'revenueGrowthPct', label: 'Revenue growth', min: -20, max: 30 },
  { key: 'ebitMarginPct', label: 'Operating margin', min: 0, max: 40 },
  { key: 'capexPctRevenue', label: 'Capital expenditure', min: 0, max: 40 },
  { key: 'nwcPctIncrementalRevenue', label: 'Working capital', min: -50, max: 60 },
  { key: 'waccPct', label: 'Discount rate', min: 0.25, max: 40 },
  { key: 'terminalGrowthPct', label: 'Terminal growth', min: -10, max: 20 },
];

function ScenarioEditor({
  draft,
  onChange,
}: {
  draft: ValuationSnapshot;
  onChange: (next: ValuationSnapshot) => void;
}) {
  const keys = ['bear', 'base', 'bull'] as const;

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Scenarios</h3>
        <span className="text-meta">Overrides sit on top of the drivers above</span>
      </div>
      <div className="panel-pad stack-6">
        <p className="text-secondary prose">
          A scenario changes several drivers together, because business outcomes arrive that way. Leave a field empty to
          keep the published assumption. The base case normally has no overrides at all.
        </p>
        {keys.map((key) => {
          const scenario = draft.scenarios[key];
          const setScenario = (patch: Partial<typeof scenario>) =>
            onChange({ ...draft, scenarios: { ...draft.scenarios, [key]: { ...scenario, ...patch } } });

          return (
            <div key={key} className="stack-4" style={{ paddingBottom: 'var(--space-4)', borderBottom: '1px solid var(--hairline)' }}>
              <TextField
                label={`${key.charAt(0).toUpperCase()}${key.slice(1)} case name`}
                value={scenario.label}
                onChange={(label) => setScenario({ label })}
                required
                maxLength={60}
                validate={(value) => (value.trim() ? null : 'Give the scenario a name.')}
              />
              <TextAreaField
                label={`${key.charAt(0).toUpperCase()}${key.slice(1)} case reasoning`}
                value={scenario.notes}
                onChange={(notes) => setScenario({ notes })}
                maxLength={600}
                rows={3}
                hint="What has to be true about the business for this case to happen."
              />
              <div className="field-row">
                {SCENARIO_OVERRIDE_FIELDS.map((field) => (
                  <NumberField
                    key={field.key}
                    label={field.label}
                    unit="%"
                    allowEmpty
                    min={field.min}
                    max={field.max}
                    step={0.25}
                    value={(scenario.overrides as Record<string, number | undefined>)[field.key] ?? null}
                    onChange={(value) => {
                      const overrides = { ...(scenario.overrides as Record<string, number>) };
                      if (value === null) delete overrides[field.key];
                      else overrides[field.key] = value;
                      setScenario({ overrides: overrides as typeof scenario.overrides });
                    }}
                    hint={`Published assumption ${formatPercent(
                      (draft.assumptions as unknown as Record<string, number>)[field.key] ?? 0,
                      2,
                    )}`}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SensitivityEditor({
  draft,
  onChange,
}: {
  draft: ValuationSnapshot;
  onChange: (next: ValuationSnapshot) => void;
}) {
  const parseAxis = (raw: string): number[] =>
    raw
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((value) => Number.isFinite(value));

  const validateAxis = (raw: string): string | null => {
    const values = parseAxis(raw);
    if (values.length < 2 || values.length > 9) return 'Enter between 2 and 9 numbers, separated by commas.';
    const ascending = values.every((value, index) => index === 0 || value > values[index - 1]);
    if (!ascending) return 'List the values low to high, with no repeats.';
    return null;
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Sensitivity grid</h3>
        <span className="text-meta">Axes shown on the public dashboard</span>
      </div>
      <div className="panel-pad field-row">
        <TextField
          label="Discount rates"
          value={draft.sensitivity.waccPct.join(', ')}
          placeholder="8.5, 9.5, 10.5, 11.5, 12.5"
          hint="Between 2 and 9 values, low to high, separated by commas. Straddle the published rate."
          validate={validateAxis}
          onChange={(raw) => {
            const values = parseAxis(raw);
            if (values.length >= 2) onChange({ ...draft, sensitivity: { ...draft.sensitivity, waccPct: values } });
          }}
        />
        <TextField
          label="Terminal growth rates"
          value={draft.sensitivity.terminalGrowthPct.join(', ')}
          placeholder="2, 3, 4, 5, 6"
          hint="Between 2 and 9 values, low to high, separated by commas."
          validate={validateAxis}
          onChange={(raw) => {
            const values = parseAxis(raw);
            if (values.length >= 2)
              onChange({ ...draft, sensitivity: { ...draft.sensitivity, terminalGrowthPct: values } });
          }}
        />
      </div>
    </section>
  );
}
