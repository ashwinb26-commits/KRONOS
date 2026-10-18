/**
 * Reported history.
 *
 * Laid out the way a financial statement reads: line items down, years across,
 * grouped by statement. Derived rows are shaded so a reader can tell at a
 * glance which numbers came off a report and which the model worked out.
 */

import { Fragment } from 'react';
import { deriveOperatingNwc } from '../../../shared/dcf';
import { HISTORICAL_FIGURE_LABELS } from '../../../shared/snapshot';
import { LINE_ITEM_GROUPS } from '../../lib/lineItems';
import type { HistoricalFigureKey, ValuationSnapshot } from '../../../shared/types';
import { TableFrame } from '../../components/ui';
import { RevenueMarginChart, type RevenueSeriesPoint } from '../../components/charts';
import { formatCrore, VERIFICATION_COPY } from '../../lib/format';
import type { DcfResult } from '../../../shared/types';

const GROUPS = LINE_ITEM_GROUPS.filter((group) => group.heading !== 'Working capital override');

export function HistoricalSection({
  snapshot,
  result,
}: {
  snapshot: ValuationSnapshot;
  result: DcfResult | null;
}) {
  const history = snapshot.historical;
  const latest = history[history.length - 1];
  const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));

  const chartData: RevenueSeriesPoint[] = [
    ...history.map((row) => ({
      label: row.year,
      revenue: row.revenue,
      marginPct: row.revenue === 0 ? 0 : (row.ebit / row.revenue) * 100,
      kind: 'history' as const,
    })),
    ...(result?.forecast ?? []).map((row) => ({
      label: row.year,
      revenue: row.revenue,
      marginPct: row.ebitMarginPct,
      kind: 'forecast' as const,
    })),
  ];

  const renderCell = (value: number | null | undefined) =>
    value === null || value === undefined || !Number.isFinite(value) ? (
      <span className="text-meta">not entered</span>
    ) : (
      <span className="num">{formatCrore(value)}</span>
    );

  const sourceCell = (key: HistoricalFigureKey) => {
    const entry = latest?.provenance?.[key];
    if (!entry) return <span className="text-meta">not linked</span>;
    const source = entry.sourceId ? sourceById.get(entry.sourceId) : undefined;
    const verification = VERIFICATION_COPY[entry.verification] ?? VERIFICATION_COPY.unverified;
    return (
      <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <span className={verification.className} style={{ fontSize: 'var(--text-meta)' }}>
          {verification.word}
        </span>
        <span className="text-meta">
          {source ? `${source.reportYear}${entry.page ? `, page ${entry.page}` : ''}` : 'no source document'}
        </span>
      </span>
    );
  };

  return (
    <section className="section" id="history" aria-labelledby="history-heading">
      <div className="section-head">
        <span className="section-step" aria-hidden="true">02</span>
        <h2 id="history-heading">Reported history</h2>
      </div>
      <p className="section-note">
        {history.length} financial years on a {snapshot.company.consolidationBasis.toLowerCase()} basis, as entered from
        the sources listed in section 10. The right-hand column shows how far the latest year has been checked.
      </p>

      <div className="stack-6">
        <RevenueMarginChart data={chartData} />

        <TableFrame
          title="Historical financial data"
          unit={snapshot.company.units}
          footnote={
            <>
              Shaded rows are worked out by the model rather than read off a report. Operating net working capital is
              trade receivables plus inventories plus other operating assets, less trade payables and other operating
              liabilities. Cash and borrowings are deliberately excluded so the change in working capital does not pick
              up financing movements.
            </>
          }
        >
          <table className="data">
            <caption className="visually-hidden">
              Reported financial figures for {snapshot.company.name}, by financial year, in {snapshot.company.units}
            </caption>
            <thead>
              <tr>
                <th scope="col">Line item</th>
                {history.map((row) => (
                  <th scope="col" key={row.year}>{row.year}</th>
                ))}
                <th scope="col">Source, latest year</th>
              </tr>
            </thead>
            <tbody>
              {GROUPS.map((group) => (
                <Fragment key={group.heading}>
                  <tr className="is-emphasis">
                    <th scope="rowgroup" colSpan={history.length + 2}>{group.heading}</th>
                  </tr>
                  {group.keys.map((key) => (
                    <tr key={key}>
                      <th scope="row">{HISTORICAL_FIGURE_LABELS[key]}</th>
                      {history.map((row) => (
                        <td key={`${key}-${row.year}`}>{renderCell(row[key] as number | null)}</td>
                      ))}
                      <td>{sourceCell(key)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}

              <tr className="is-emphasis">
                <th scope="rowgroup" colSpan={history.length + 2}>Worked out by the model</th>
              </tr>
              <tr className="is-derived">
                <th scope="row">Operating net working capital</th>
                {history.map((row) => (
                  <td key={`nwc-${row.year}`}>
                    <span className="num">{formatCrore(deriveOperatingNwc(row))}</span>
                  </td>
                ))}
                <td><span className="text-meta">derived</span></td>
              </tr>
              <tr className="is-derived">
                <th scope="row">Operating margin</th>
                {history.map((row) => (
                  <td key={`margin-${row.year}`}>
                    <span className="num">
                      {row.revenue === 0 ? 'n/a' : `${((row.ebit / row.revenue) * 100).toFixed(1)}%`}
                    </span>
                  </td>
                ))}
                <td><span className="text-meta">derived</span></td>
              </tr>
              <tr className="is-derived">
                <th scope="row">Revenue growth on the prior year</th>
                {history.map((row, index) => (
                  <td key={`growth-${row.year}`}>
                    {index === 0 ? (
                      <span className="text-meta">no prior year</span>
                    ) : (
                      <span className="num">
                        {`${(((row.revenue / history[index - 1].revenue) - 1) * 100).toFixed(1)}%`}
                      </span>
                    )}
                  </td>
                ))}
                <td><span className="text-meta">derived</span></td>
              </tr>
            </tbody>
          </table>
        </TableFrame>
      </div>
    </section>
  );
}
