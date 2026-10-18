/**
 * Client-side file downloads. An analytics page people cannot get the numbers
 * out of is a dead end, so the published snapshot and the forecast are both
 * exportable without a server round trip.
 */

import type { DcfResult, ValuationSnapshot } from '../../shared/types';

function saveBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next tick so the download has definitely started.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The whole data file, named exactly as it is in the repository, so uploading
 * it to public/data replaces the old one instead of sitting next to it.
 */
export function downloadDataFile(content: string) {
  saveBlob('valuations.json', new Blob([content], { type: 'application/json' }));
}

export function downloadSnapshotJson(snapshot: ValuationSnapshot) {
  saveBlob(
    `${snapshot.company.ticker.toLowerCase()}-${snapshot.id}.json`,
    new Blob([`${JSON.stringify(snapshot, null, 2)}\n`], { type: 'application/json' }),
  );
}

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function downloadForecastCsv(snapshot: ValuationSnapshot, result: DcfResult) {
  const header = [
    'Financial year',
    'Revenue',
    'Revenue growth %',
    'EBIT',
    'EBIT margin %',
    'Tax on EBIT',
    'NOPAT',
    'Depreciation and amortisation',
    'Capital expenditure',
    'Change in operating working capital',
    'Free cash flow to the firm',
    'Discount factor',
    'Present value of FCFF',
  ];

  const rows = result.forecast.map((row) => [
    row.year,
    row.revenue,
    row.revenueGrowthPct,
    row.ebit,
    row.ebitMarginPct,
    row.taxesOnEbit,
    row.nopat,
    row.depreciation,
    row.capex,
    row.changeInNwc,
    row.fcff,
    row.discountFactor,
    row.presentValueFcff,
  ]);

  const preamble = [
    `# ${snapshot.company.name} (${snapshot.company.exchange}: ${snapshot.company.ticker})`,
    `# Snapshot ${snapshot.id}, valuation date ${snapshot.company.valuationDate}`,
    `# Data status: ${snapshot.dataStatus}`,
    `# Figures in ${snapshot.company.units}`,
    `# Discount rate ${result.wacc.waccPct}%, terminal growth ${snapshot.assumptions.terminalGrowthPct}%`,
  ];

  const csv = [
    ...preamble,
    header.map(csvCell).join(','),
    ...rows.map((row) => row.map(csvCell).join(',')),
  ].join('\n');

  saveBlob(`${snapshot.company.ticker.toLowerCase()}-${snapshot.id}-forecast.csv`, new Blob([`${csv}\n`], { type: 'text/csv' }));
}
