/**
 * What could be different, and where the numbers came from: the sensitivity
 * grid, the three scenarios, the formulas written out, and the source trail.
 */

import { useState } from 'react';
import type { DcfResult, HistoricalFigureKey, ValuationSnapshot } from '../../../shared/types';
import { HISTORICAL_FIGURE_LABELS } from '../../../shared/snapshot';
import { EmptyState, SelectField, TableFrame } from '../../components/ui';
import { ScenarioChart } from '../../components/charts';
import { External } from '../../components/icons';
import { formatDate, formatPercent, formatPerShare, CLASSIFICATION_COPY, VERIFICATION_COPY } from '../../lib/format';
import type { ScenarioOutcome } from '../../lib/model';
import type { SensitivityCell } from '../../../shared/dcf';

export function SensitivitySection({
  snapshot,
  grid,
  currentWaccPct,
}: {
  snapshot: ValuationSnapshot;
  grid: SensitivityCell[][];
  currentWaccPct: number;
}) {
  const axes = snapshot.sensitivity;
  const values = grid.flat().map((cell) => cell.valuePerShare).filter((value): value is number => value !== null);
  const min = values.length > 0 ? Math.min(...values) : 0;
  const max = values.length > 0 ? Math.max(...values) : 1;
  const currentGrowth = snapshot.assumptions.terminalGrowthPct;

  // Nearest axis value, since the discount rate in use is rarely exactly on a
  // grid line when it is derived from its components.
  const nearestWacc = axes.waccPct.reduce(
    (best, value) => (Math.abs(value - currentWaccPct) < Math.abs(best - currentWaccPct) ? value : best),
    axes.waccPct[0] ?? currentWaccPct,
  );

  return (
    <section className="section" id="sensitivity" aria-labelledby="sensitivity-heading">
      <div className="section-head">
        <span className="section-step" aria-hidden="true">07</span>
        <h2 id="sensitivity-heading">Sensitivity</h2>
      </div>
      <p className="section-note">
        Implied value per share as the discount rate and the terminal growth rate move, with every operating assumption
        held still. A discounted cash flow does not produce one price, it produces a range, and the width of this grid
        is that range.
      </p>

      <TableFrame
        title="Value per share across discount rate and terminal growth"
        unit="rupees per share"
        footnote={
          <>
            Rows are the weighted average cost of capital, columns are the terminal growth rate. The outlined cell is
            closest to the published assumptions, {formatPercent(currentWaccPct, 2)} against{' '}
            {formatPercent(currentGrowth, 2)}. Blank cells are combinations the formula cannot value, which happens
            whenever terminal growth reaches the discount rate.
          </>
        }
      >
        <table className="grid">
          <caption className="visually-hidden">
            Sensitivity of value per share to the discount rate and the terminal growth rate
          </caption>
          <thead>
            <tr>
              <th scope="col">Cost of capital, down. Terminal growth, across.</th>
              {axes.terminalGrowthPct.map((growth) => (
                <th scope="col" key={growth}>{formatPercent(growth, 2)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, rowIndex) => (
              <tr key={axes.waccPct[rowIndex]}>
                <th scope="row">{formatPercent(axes.waccPct[rowIndex], 2)}</th>
                {row.map((cell) => {
                  const isCurrent =
                    cell.waccPct === nearestWacc && cell.terminalGrowthPct === currentGrowth;
                  const intensity =
                    cell.valuePerShare === null || max === min
                      ? 0
                      : ((cell.valuePerShare - min) / (max - min)) * 0.2 + 0.02;
                  return (
                    <td
                      key={`${cell.waccPct}-${cell.terminalGrowthPct}`}
                      className={isCurrent ? 'is-current' : undefined}
                      style={{ background: `rgba(15, 107, 97, ${intensity.toFixed(3)})` }}
                      title={cell.error ?? undefined}
                    >
                      <span className="num">
                        {cell.valuePerShare === null ? 'cannot be valued' : formatPerShare(cell.valuePerShare)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
    </section>
  );
}

export function ScenarioSection({
  outcomes,
  activeKey,
}: {
  outcomes: ScenarioOutcome[];
  activeKey: string;
}) {
  return (
    <section className="section" id="scenarios" aria-labelledby="scenarios-heading">
      <div className="section-head">
        <span className="section-step" aria-hidden="true">08</span>
        <h2 id="scenarios-heading">Scenarios</h2>
      </div>
      <p className="section-note">
        Three coherent views of the same business rather than one point estimate. Each changes a set of operating
        assumptions together, which is how business outcomes actually arrive. Switch the scenario at the top of the page
        to recalculate every table.
      </p>

      <div className="stack-6">
        <ScenarioChart
          points={outcomes.map((outcome) => ({
            key: outcome.key,
            label: outcome.label,
            valuePerShare: outcome.valuePerShare,
            active: outcome.key === activeKey,
          }))}
        />

        <div className="scenario-grid">
          {outcomes.map((outcome) => (
            <article className="scenario" key={outcome.key} data-active={outcome.key === activeKey ? 'true' : 'false'}>
              <h4>{outcome.label}</h4>
              <span className="scenario-value">
                {outcome.valuePerShare === null ? 'cannot be valued' : formatPerShare(outcome.valuePerShare)}
              </span>
              <p>{outcome.error ?? outcome.notes}</p>
              {outcome.waccPct !== null ? (
                <p style={{ marginTop: 'var(--space-2)' }}>
                  Discount rate {formatPercent(outcome.waccPct, 2)}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function MethodologySection({
  snapshot,
  result,
}: {
  snapshot: ValuationSnapshot;
  result: DcfResult;
}) {
  const notes = [
    {
      title: 'Free cash flow to the firm',
      body: 'Cash the business generates before any payment to lenders or shareholders. Operating profit is taxed, depreciation is added back because it is not a cash cost, and the cash the business has to put back into assets and working capital is taken out.',
      formula: 'FCFF = EBIT x (1 - tax rate) + depreciation and amortisation - capital expenditure - increase in operating working capital',
    },
    {
      title: 'Present value',
      body: 'A rupee arriving in 5 years is worth less than a rupee today, so each forecast cash flow is divided by the discount rate compounded over the years until it arrives.',
      formula: 'Present value in year t = FCFF in year t / (1 + WACC) ^ t',
    },
    {
      title: 'Weighted average cost of capital',
      body: 'The return the business has to earn to satisfy everybody funding it, weighted by how much of the funding each group provides. Interest is deductible, so the cost of debt is taken after tax.',
      formula: 'WACC = equity weight x cost of equity + debt weight x cost of debt x (1 - marginal tax rate)',
    },
    {
      title: 'Terminal value',
      body: 'A single figure standing in for every year after the forecast window, assuming cash flow then grows at a constant rate forever. It only means anything while the growth rate stays below the discount rate.',
      formula: 'Terminal value = final year FCFF x (1 + terminal growth) / (WACC - terminal growth)',
    },
    {
      title: 'Equity bridge',
      body: 'Enterprise value is the whole business. Debt, leases, minority stakes and other claims ranking ahead of equity are taken out, and cash and investments not already inside the forecast are added back.',
      formula: 'Equity value = enterprise value - debt-like claims + cash and non-operating investments',
    },
    {
      title: 'What this model simplifies',
      body: `Depreciation and capital expenditure are set as a percentage of revenue rather than modelled off an asset schedule, and working capital moves with incremental revenue. An effective operating tax rate is applied to positive operating profit, so deferred tax, carried-forward losses and one-off tax items are not modelled. The forecast runs ${result.forecast.length} years. Treat it as a disciplined estimate, not a precise one.`,
      formula: '',
    },
  ];

  return (
    <section className="section" id="methodology" aria-labelledby="methodology-heading">
      <div className="section-head">
        <span className="section-step" aria-hidden="true">09</span>
        <h2 id="methodology-heading">Methodology</h2>
      </div>
      <p className="section-note">
        Every formula this page uses, written out. Model version {snapshot.modelVersion}.
      </p>

      <div className="panel">
        {notes.map((note) => (
          <div className="formula" key={note.title}>
            <h4>{note.title}</h4>
            <p>{note.body}</p>
            {note.formula ? <code>{note.formula}</code> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export function SourcesSection({ snapshot }: { snapshot: ValuationSnapshot }) {
  const years = snapshot.historical.map((row) => row.year);
  const [year, setYear] = useState(years[years.length - 1] ?? '');
  const row = snapshot.historical.find((entry) => entry.year === year) ?? snapshot.historical[0];
  const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));
  const entries = Object.entries(row?.provenance ?? {}) as Array<
    [HistoricalFigureKey, NonNullable<typeof row>['provenance'][HistoricalFigureKey]]
  >;

  return (
    <section className="section" id="sources" aria-labelledby="sources-heading">
      <div className="section-head">
        <span className="section-step" aria-hidden="true">10</span>
        <h2 id="sources-heading">Sources and verification</h2>
      </div>
      <p className="section-note">
        A valuation is only as good as the figures underneath it. Each reported line carries the document it came from,
        the page it sits on, and how far it has been checked.
      </p>

      <div className="stack-6">
        <div className="panel">
          <div className="panel-head">
            <h3>Source documents</h3>
            <span className="text-meta">{snapshot.sources.length} recorded</span>
          </div>
          {snapshot.sources.length === 0 ? (
            <EmptyState title="No source documents recorded yet">
              Once the annual reports are entered in the studio, each one appears here with the year it covers and the
              date it was retrieved, so a reader can check any figure on this page against the original.
            </EmptyState>
          ) : (
            <ul className="sources">
              {snapshot.sources.map((source) => (
                <li key={source.id}>
                  <a href={source.url} target="_blank" rel="noreferrer noopener">
                    {source.label} <External />
                  </a>
                  <div className="source-meta">
                    <span>Covers <b>{source.reportYear}</b></span>
                    <span>Retrieved <b>{formatDate(source.retrievedOn)}</b></span>
                    <span>Reference <b>{source.id}</b></span>
                  </div>
                  {source.notes ? <p className="text-meta" style={{ marginTop: 'var(--space-2)' }}>{source.notes}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <TableFrame
          title="Source trail"
          actions={
            <div style={{ minWidth: 200 }}>
              <SelectField
                label="Financial year"
                value={year}
                options={years.map((entry) => ({ value: entry, label: entry }))}
                onChange={setYear}
              />
            </div>
          }
          footnote={
            <>
              Reported means the figure was read off the statement named. Derived means the model worked it out from
              other figures. Assumption means the analyst chose it. A snapshot can only be published as verified
              research once every reported line reads Verified.
            </>
          }
        >
          {entries.length === 0 ? (
            <EmptyState title={`No source trail recorded for ${year}`}>
              Nothing in this year has been linked to a document yet. The studio records the report, page, unit and
              verification state for each figure as it is entered.
            </EmptyState>
          ) : (
            <table className="data">
              <caption className="visually-hidden">Source and verification state for each figure in {year}</caption>
              <thead>
                <tr>
                  <th scope="col">Line item</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Statement</th>
                  <th scope="col">Document</th>
                  <th scope="col">Page</th>
                  <th scope="col">Unit</th>
                  <th scope="col">Checked</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(([key, entry]) => {
                  if (!entry) return null;
                  const source = entry.sourceId ? sourceById.get(entry.sourceId) : undefined;
                  const verification = VERIFICATION_COPY[entry.verification] ?? VERIFICATION_COPY.unverified;
                  return (
                    <tr key={key}>
                      <th scope="row">{HISTORICAL_FIGURE_LABELS[key]}</th>
                      <td>{CLASSIFICATION_COPY[entry.classification] ?? entry.classification}</td>
                      <td style={{ whiteSpace: 'normal' }}>{entry.statement || 'not recorded'}</td>
                      <td style={{ whiteSpace: 'normal' }}>
                        {source ? (
                          <a href={source.url} target="_blank" rel="noreferrer noopener">{source.reportYear}</a>
                        ) : (
                          <span className="text-meta">no document</span>
                        )}
                      </td>
                      <td>{entry.page || <span className="text-meta">none</span>}</td>
                      <td>{entry.unit || <span className="text-meta">none</span>}</td>
                      <td><span className={verification.className}>{verification.word}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </TableFrame>
      </div>
    </section>
  );
}
