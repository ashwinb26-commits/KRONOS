/**
 * The model itself, in the order it is calculated: forecast drivers and free
 * cash flow, then the discount rate, then discounting and terminal value, then
 * the walk down to a per-share figure.
 */

import type { DcfResult, ValuationSnapshot } from '../../../shared/types';
import { TableFrame } from '../../components/ui';
import { BridgeWaterfall, FcffChart } from '../../components/charts';
import { formatCrore, formatCroreSigned, formatPerShare, formatPercent } from '../../lib/format';

export function ForecastSection({
  snapshot,
  result,
}: {
  snapshot: ValuationSnapshot;
  result: DcfResult;
}) {
  const { forecast } = result;
  const unit = snapshot.company.units;

  const rows: Array<{ label: string; render: (row: DcfResult['forecast'][number]) => string; emphasis?: boolean; note?: string }> = [
    { label: 'Revenue', render: (row) => formatCrore(row.revenue) },
    { label: 'Revenue growth', render: (row) => formatPercent(row.revenueGrowthPct) },
    { label: 'EBIT', render: (row) => formatCrore(row.ebit) },
    { label: 'EBIT margin', render: (row) => formatPercent(row.ebitMarginPct) },
    { label: 'Tax on EBIT', render: (row) => formatCrore(-row.taxesOnEbit) },
    { label: 'Net operating profit after tax', render: (row) => formatCrore(row.nopat) },
    { label: 'Add depreciation and amortisation', render: (row) => formatCrore(row.depreciation) },
    { label: 'Less capital expenditure', render: (row) => formatCrore(-row.capex) },
    { label: 'Less change in operating working capital', render: (row) => formatCrore(-row.changeInNwc) },
    { label: 'Free cash flow to the firm', render: (row) => formatCrore(row.fcff), emphasis: true },
    { label: 'Discount factor', render: (row) => row.discountFactor.toFixed(4) },
    { label: 'Present value of free cash flow', render: (row) => formatCrore(row.presentValueFcff), emphasis: true },
  ];

  return (
    <section className="section" id="forecast" aria-labelledby="forecast-heading">
      <div className="section-head">
        <span className="section-step" aria-hidden="true">03</span>
        <h2 id="forecast-heading">Forecast and free cash flow</h2>
      </div>
      <p className="section-note">
        Revenue rolls forward from the last reported year at the growth assumed for each year. Operating profit comes
        off the margin assumption, tax is charged on positive operating profit only, and the result is converted to
        cash by adding back depreciation and taking out what the business has to reinvest.
      </p>

      <div className="stack-6">
        <FcffChart forecast={forecast} />

        <TableFrame
          title="Forecast build-up"
          unit={unit}
          footnote={
            <>
              Free cash flow to the firm is operating profit after tax, plus depreciation and amortisation, less capital
              expenditure, less the increase in operating working capital. The discount factor is one divided by
              {' '}{formatPercent(result.wacc.waccPct, 2)} compounded over the number of years to that cash flow.
            </>
          }
        >
          <table className="data">
            <caption className="visually-hidden">Forecast free cash flow by year, in {unit}</caption>
            <thead>
              <tr>
                <th scope="col">Line item</th>
                {forecast.map((row) => (
                  <th scope="col" key={row.year}>{row.year}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className={row.emphasis ? 'is-emphasis' : undefined}>
                  <th scope="row">{row.label}</th>
                  {forecast.map((entry) => (
                    <td key={`${row.label}-${entry.year}`}>
                      <span className="num">{row.render(entry)}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Present value of the explicit forecast</th>
                <td colSpan={forecast.length}>
                  <span className="num">{formatCrore(result.presentValueForecastCashFlows)}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </TableFrame>
      </div>
    </section>
  );
}

export function CostOfCapitalSection({
  snapshot,
  result,
}: {
  snapshot: ValuationSnapshot;
  result: DcfResult;
}) {
  const wacc = snapshot.assumptions.wacc;
  const breakdown = result.wacc;

  return (
    <section className="section" id="cost-of-capital" aria-labelledby="wacc-heading">
      <div className="section-head">
        <span className="section-step" aria-hidden="true">04</span>
        <h2 id="wacc-heading">Cost of capital</h2>
      </div>
      <p className="section-note">
        {breakdown.mode === 'derived'
          ? 'The discount rate is built from its parts rather than assumed, so each input can be argued with separately.'
          : 'A single discount rate is assumed directly. The component inputs below are recorded for reference but are not what drives the discounting.'}
      </p>

      <TableFrame
        title="Weighted average cost of capital"
        unit="% a year"
        footnote={
          <>
            Cost of equity is the risk-free rate plus beta multiplied by the equity risk premium, plus any documented
            add-on. The weighted average cost of capital is the equity weight multiplied by the cost of equity, plus the
            debt weight multiplied by the cost of debt after tax. Market-derived inputs should carry the date they were
            observed in the research notes.
          </>
        }
      >
        <table className="data">
          <caption className="visually-hidden">Cost of capital build-up</caption>
          <thead>
            <tr>
              <th scope="col">Input</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Risk-free rate</th>
              <td><span className="num">{wacc ? formatPercent(wacc.riskFreeRatePct, 2) : 'not recorded'}</span></td>
            </tr>
            <tr>
              <th scope="row">Levered beta</th>
              <td><span className="num">{wacc ? wacc.betaLevered.toFixed(2) : 'not recorded'}</span></td>
            </tr>
            <tr>
              <th scope="row">Equity risk premium</th>
              <td><span className="num">{wacc ? formatPercent(wacc.equityRiskPremiumPct, 2) : 'not recorded'}</span></td>
            </tr>
            {wacc && wacc.additionalEquityPremiumPct > 0 ? (
              <tr>
                <th scope="row">Additional equity premium</th>
                <td><span className="num">{formatPercent(wacc.additionalEquityPremiumPct, 2)}</span></td>
              </tr>
            ) : null}
            <tr className="is-emphasis">
              <th scope="row">Cost of equity</th>
              <td><span className="num">{formatPercent(breakdown.costOfEquityPct, 2)}</span></td>
            </tr>
            <tr>
              <th scope="row">Cost of debt before tax</th>
              <td><span className="num">{formatPercent(breakdown.costOfDebtPreTaxPct, 2)}</span></td>
            </tr>
            <tr>
              <th scope="row">Marginal tax rate on the debt shield</th>
              <td><span className="num">{wacc ? formatPercent(wacc.marginalTaxRatePct, 2) : 'not recorded'}</span></td>
            </tr>
            <tr className="is-emphasis">
              <th scope="row">Cost of debt after tax</th>
              <td><span className="num">{formatPercent(breakdown.costOfDebtAfterTaxPct, 2)}</span></td>
            </tr>
            <tr>
              <th scope="row">Equity weight</th>
              <td><span className="num">{formatPercent(breakdown.equityWeightPct, 2)}</span></td>
            </tr>
            <tr>
              <th scope="row">Debt weight</th>
              <td><span className="num">{formatPercent(breakdown.debtWeightPct, 2)}</span></td>
            </tr>
            <tr className="is-emphasis">
              <th scope="row">Weighted average cost of capital</th>
              <td><span className="num">{formatPercent(breakdown.waccPct, 2)}</span></td>
            </tr>
            <tr>
              <th scope="row">Terminal growth rate</th>
              <td><span className="num">{formatPercent(snapshot.assumptions.terminalGrowthPct, 2)}</span></td>
            </tr>
          </tbody>
        </table>
      </TableFrame>
    </section>
  );
}

export function TerminalValueSection({
  snapshot,
  result,
}: {
  snapshot: ValuationSnapshot;
  result: DcfResult;
}) {
  const unit = snapshot.company.units;
  const finalYear = result.forecast[result.forecast.length - 1];

  return (
    <section className="section" id="terminal-value" aria-labelledby="terminal-heading">
      <div className="section-head">
        <span className="section-step" aria-hidden="true">05</span>
        <h2 id="terminal-heading">Discounting and terminal value</h2>
      </div>
      <p className="section-note">
        Everything beyond the forecast window is collapsed into one figure using the perpetual growth formula. The share
        of enterprise value it accounts for is the single most useful number for judging how much of this valuation
        rests on assumption rather than on forecast.
      </p>

      <TableFrame title="From cash flows to enterprise value" unit={unit}>
        <table className="data">
          <caption className="visually-hidden">Present value of forecast cash flows and terminal value</caption>
          <thead>
            <tr>
              <th scope="col">Step</th>
              <th scope="col">Figure</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Present value of the {result.forecast.length} forecast years</th>
              <td><span className="num">{formatCrore(result.presentValueForecastCashFlows)}</span></td>
            </tr>
            <tr>
              <th scope="row">Free cash flow in {finalYear.year}</th>
              <td><span className="num">{formatCrore(finalYear.fcff)}</span></td>
            </tr>
            <tr>
              <th scope="row">Terminal value at the end of {finalYear.year}</th>
              <td><span className="num">{formatCrore(result.terminalValue)}</span></td>
            </tr>
            <tr>
              <th scope="row">Present value of the terminal value</th>
              <td><span className="num">{formatCrore(result.presentValueTerminalValue)}</span></td>
            </tr>
            <tr className="is-emphasis">
              <th scope="row">Enterprise value</th>
              <td><span className="num">{formatCrore(result.enterpriseValue)}</span></td>
            </tr>
            <tr>
              <th scope="row">Terminal value as a share of enterprise value</th>
              <td><span className="num">{formatPercent(result.terminalValueShareOfEnterpriseValuePct)}</span></td>
            </tr>
          </tbody>
        </table>
      </TableFrame>

      <div className="panel panel-pad stack-3" style={{ marginTop: 'var(--space-4)' }}>
        <h3>The formula, written out</h3>
        <p className="text-secondary prose">
          Terminal value is free cash flow in the final forecast year, grown one more year, divided by the discount rate
          less the terminal growth rate. The result sits at the end of the forecast window, so it is then discounted
          back over the same {result.forecast.length} years.
        </p>
        <code style={{
          display: 'block',
          padding: 'var(--space-3)',
          background: 'var(--surface-sunken)',
          borderRadius: 'var(--radius-sm)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-secondary)',
          overflowX: 'auto',
        }}>
          {formatCrore(finalYear.fcff)} x (1 + {snapshot.assumptions.terminalGrowthPct}%) /
          ({formatPercent(result.wacc.waccPct, 2)} - {snapshot.assumptions.terminalGrowthPct}%) ={' '}
          {formatCrore(result.terminalValue)}
        </code>
      </div>
    </section>
  );
}

export function BridgeSection({
  snapshot,
  result,
}: {
  snapshot: ValuationSnapshot;
  result: DcfResult;
}) {
  const unit = snapshot.company.units;
  const bridge = snapshot.assumptions.bridge;
  const shares = bridge?.dilutedShares ?? snapshot.assumptions.dilutedSharesCrore;

  return (
    <section className="section" id="bridge" aria-labelledby="bridge-heading">
      <div className="section-head">
        <span className="section-step" aria-hidden="true">06</span>
        <h2 id="bridge-heading">Enterprise value to value per share</h2>
      </div>
      <p className="section-note">
        Enterprise value belongs to everybody with a claim on the business. This is the walk from that figure down to
        what is left for a shareholder, with each claim named once and only once.
      </p>

      <div className="stack-6">
        <BridgeWaterfall lines={result.bridge} unit={unit} />

        <TableFrame
          title="Value bridge"
          unit={unit}
          footnote={
            bridge ? (
              <>
                Leases are treated as {bridge.leaseTreatment === 'capitalised' ? 'capitalised' : 'an operating expense'}
                {bridge.leaseTreatment === 'capitalised'
                  ? bridge.leasesIncludedInGrossDebt
                    ? ', and the lease liability is already inside gross debt, so it is not deducted a second time.'
                    : ', so the lease liability is deducted alongside borrowings.'
                  : ', so lease costs are already inside operating profit and the liability is not deducted as well.'}
              </>
            ) : (
              <>This snapshot uses a single net debt figure rather than an itemised bridge.</>
            )
          }
        >
          <table className="data">
            <caption className="visually-hidden">Walk from enterprise value to equity value and value per share</caption>
            <thead>
              <tr>
                <th scope="col">Step</th>
                <th scope="col">Amount</th>
                <th scope="col">Running total</th>
              </tr>
            </thead>
            <tbody>
              {result.bridge.map((line) => (
                <tr key={line.key} className={line.kind === 'start' || line.kind === 'total' ? 'is-emphasis' : undefined}>
                  <th scope="row">
                    {line.label}
                    {line.note ? <span className="text-meta" style={{ display: 'block' }}>{line.note}</span> : null}
                  </th>
                  <td>
                    <span className={`num${line.kind === 'subtract' ? ' neg' : ''}`}>
                      {line.kind === 'start' || line.kind === 'total'
                        ? formatCrore(line.amount)
                        : formatCroreSigned(line.amount)}
                    </span>
                  </td>
                  <td><span className="num">{formatCrore(line.runningTotal)}</span></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Diluted shares outstanding</th>
                <td colSpan={2}><span className="num">{formatCrore(shares)} crore</span></td>
              </tr>
              <tr>
                <th scope="row">Implied value per share</th>
                <td colSpan={2}><span className="num">{formatPerShare(result.intrinsicValuePerShare)}</span></td>
              </tr>
            </tfoot>
          </table>
        </TableFrame>
      </div>
    </section>
  );
}
