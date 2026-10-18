/**
 * Historical data editor.
 *
 * Two tables. The first is the spreadsheet: line items down, financial years
 * across, one input per cell. The second records where each figure came from.
 *
 * Cells hold their own text while being typed and commit on blur or Enter, so
 * a 130-cell sheet does not re-run the model on every keystroke, and a
 * half-typed number never reaches the engine.
 */

import { useMemo, useState } from 'react';
import { Fragment } from 'react';
import { deriveOperatingNwc } from '../../../shared/dcf';
import { HISTORICAL_FIGURE_LABELS } from '../../../shared/snapshot';
import type { HistoricalFigureKey, ValuationSnapshot } from '../../../shared/types';
import { LINE_ITEM_GROUPS, LINE_ITEM_HELP, REQUIRED_KEYS } from '../../lib/lineItems';
import { formatCrore } from '../../lib/format';
import {
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  SelectField,
  TableFrame,
  Tooltip,
} from '../../components/ui';
import { Close, Copy } from '../../components/icons';
import {
  CLASSIFICATION_OPTIONS,
  VERIFICATION_OPTIONS,
  addYear,
  applyProvenanceToAllYears,
  copyPreviousYear,
  removeYear,
  setFigure,
  setProvenanceField,
  setYearLabel,
} from './editing';

/** One numeric cell. Keeps its own draft text, commits on blur or Enter. */
function SheetCell({
  value,
  label,
  optional,
  onCommit,
}: {
  value: number | null;
  label: string;
  optional: boolean;
  onCommit: (next: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const [invalid, setInvalid] = useState(false);

  // Follow the model when it changes from elsewhere, for example a copied row.
  const [lastSeen, setLastSeen] = useState(value);
  if (lastSeen !== value) {
    setLastSeen(value);
    setText(value === null ? '' : String(value));
    setInvalid(false);
  }

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      if (optional) {
        setInvalid(false);
        onCommit(null);
      } else {
        setInvalid(true);
      }
      return;
    }
    const parsed = Number(trimmed.replace(/,/g, ''));
    if (!Number.isFinite(parsed)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setText(String(parsed));
    onCommit(parsed);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      aria-label={label}
      aria-invalid={invalid ? 'true' : undefined}
      onChange={(event) => {
        if (invalid) setInvalid(false);
        setText(event.target.value);
      }}
      onFocus={() => setInvalid(false)}
      onBlur={(event) => commit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit((event.target as HTMLInputElement).value);
          (event.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function HistoricalPanel({
  draft,
  onChange,
}: {
  draft: ValuationSnapshot;
  onChange: (next: ValuationSnapshot) => void;
}) {
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const years = draft.historical;

  return (
    <div className="stack-6">
      <Banner tone="neutral" title={`Figures are entered in ${draft.company.units || 'the reporting unit set in section 1'}`}>
        Keep every year on the same basis. Capital expenditure and depreciation go in as positive figures. Leave a cell
        empty when the figure has not been extracted yet, apart from revenue, operating profit, depreciation and capital
        expenditure, which the model cannot run without.
      </Banner>

      {years.length === 0 ? (
        <div className="panel">
          <EmptyState
            title="No financial years in this draft"
            actions={<Button variant="primary" onClick={() => onChange(addYear(draft))}>Add financial year</Button>}
          >
            A discounted cash flow forecasts from the latest reported year, so the draft needs at least one. Five years
            of history is enough to see the trend in margins and reinvestment.
          </EmptyState>
        </div>
      ) : (
        <TableFrame
          title="Historical financial data"
          actions={
            <div className="btn-row">
              <span className="text-meta">{years.length} years</span>
              <Button variant="secondary" onClick={() => onChange(addYear(draft))}>Add financial year</Button>
            </div>
          }
          footnote={
            <>
              Shaded rows are worked out by the model and cannot be typed into. Operating net working capital derives
              from receivables, inventories and payables unless the override row is filled in.
            </>
          }
        >
          <table className="sheet">
            <caption className="visually-hidden">Editable historical financial data by line item and year</caption>
            <thead>
              <tr>
                <th scope="col">Line item</th>
                {years.map((row, index) => (
                  <th scope="col" key={`${row.year}-${index}`}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                      <input
                        type="text"
                        value={row.year}
                        aria-label={`Label for year ${index + 1}`}
                        /* Fixed pixels, not ch: box-sizing is border-box, so a
                           ch width would have the cell padding eaten out of it
                           and clip the year label. */
                        style={{ width: '116px', minWidth: '116px', textAlign: 'right' }}
                        onChange={(event) => onChange(setYearLabel(draft, index, event.target.value))}
                      />
                      <IconButton
                        label={`Remove ${row.year}`}
                        icon={<Close />}
                        onClick={() => setPendingRemoval(row.year)}
                      />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LINE_ITEM_GROUPS.map((group) => (
                <Fragment key={group.heading}>
                  <tr>
                    <th scope="rowgroup" colSpan={years.length + 1} style={{ background: 'var(--accent-wash)' }}>
                      {group.heading}
                    </th>
                  </tr>
                  {group.keys.map((key) => (
                    <tr key={key}>
                      <th scope="row">
                        {HISTORICAL_FIGURE_LABELS[key]}
                        {REQUIRED_KEYS.includes(key) ? null : <span className="text-meta"> optional</span>}
                        {LINE_ITEM_HELP[key] ? (
                          <span className="text-meta" style={{ display: 'block' }}>{LINE_ITEM_HELP[key]}</span>
                        ) : null}
                      </th>
                      {years.map((row, index) => (
                        <td key={`${key}-${index}`}>
                          <SheetCell
                            value={row[key] as number | null}
                            label={`${HISTORICAL_FIGURE_LABELS[key]} for ${row.year}`}
                            optional={!REQUIRED_KEYS.includes(key)}
                            onCommit={(next) => onChange(setFigure(draft, index, key, next))}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}

              <tr>
                <th scope="rowgroup" colSpan={years.length + 1} style={{ background: 'var(--accent-wash)' }}>
                  Worked out by the model
                </th>
              </tr>
              <tr className="is-derived">
                <th scope="row">Operating net working capital in use</th>
                {years.map((row, index) => (
                  <td key={`nwc-${index}`}>
                    <span className="sheet-derived num">{formatCrore(deriveOperatingNwc(row))}</span>
                  </td>
                ))}
              </tr>
              <tr className="is-derived">
                <th scope="row">Operating margin</th>
                {years.map((row, index) => (
                  <td key={`margin-${index}`}>
                    <span className="sheet-derived num">
                      {row.revenue ? `${((row.ebit / row.revenue) * 100).toFixed(1)}%` : 'n/a'}
                    </span>
                  </td>
                ))}
              </tr>
              <tr className="is-derived">
                <th scope="row">Copy the previous year into this one</th>
                {years.map((row, index) => (
                  <td key={`copy-${index}`} style={{ textAlign: 'right', paddingRight: 'var(--space-3)' }}>
                    {index === 0 ? (
                      <span className="sheet-derived text-meta">no prior year</span>
                    ) : (
                      <Tooltip label={`Copy ${years[index - 1].year} into ${row.year}`}>
                        {(described) => (
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`Copy ${years[index - 1].year} into ${row.year}`}
                            onClick={() => onChange(copyPreviousYear(draft, index))}
                            {...described}
                          >
                            <Copy />
                          </button>
                        )}
                      </Tooltip>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </TableFrame>
      )}

      {years.length > 0 ? <ProvenanceEditor draft={draft} onChange={onChange} /> : null}

      <ConfirmDialog
        open={pendingRemoval !== null}
        title={`Remove ${pendingRemoval ?? ''} from this draft?`}
        confirmLabel="Remove financial year"
        tone="danger"
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => {
          if (pendingRemoval) onChange(removeYear(draft, pendingRemoval));
          setPendingRemoval(null);
        }}
      >
        <p className="text-secondary">
          Every figure and source reference for {pendingRemoval} goes with it. This changes the draft in this browser
          only. Snapshots already published keep their copy of this year, so nothing historical is lost.
        </p>
      </ConfirmDialog>
    </div>
  );
}

function ProvenanceEditor({
  draft,
  onChange,
}: {
  draft: ValuationSnapshot;
  onChange: (next: ValuationSnapshot) => void;
}) {
  const years = draft.historical.map((row) => row.year);
  const [year, setYear] = useState(years[years.length - 1] ?? '');
  const yearIndex = Math.max(0, draft.historical.findIndex((row) => row.year === year));
  const row = draft.historical[yearIndex];

  const sourceOptions = useMemo(
    () => [
      { value: '', label: 'No document linked' },
      ...draft.sources.map((source) => ({ value: source.id, label: `${source.id}, ${source.reportYear}` })),
    ],
    [draft.sources],
  );

  if (!row) return null;

  const statementFor = (key: HistoricalFigureKey) =>
    LINE_ITEM_GROUPS.find((group) => group.keys.includes(key))?.statement ?? '';

  const entryFor = (key: HistoricalFigureKey) =>
    row.provenance?.[key] ?? {
      sourceId: '',
      page: '',
      statement: '',
      unit: draft.company.units,
      classification: 'reported' as const,
      verification: 'unverified' as const,
    };

  return (
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
          The copy button applies the document, statement and kind of a line to every year at once, leaving page numbers
          alone since those differ year to year. A snapshot cannot be published as verified research until every
          reported line here reads Verified and has a document and page.
        </>
      }
    >
      <table className="sheet" style={{ minWidth: 1040 }}>
        <caption className="visually-hidden">Source document, page and verification state for each figure in {year}</caption>
        <thead>
          <tr>
            <th scope="col">Line item</th>
            <th scope="col" style={{ textAlign: 'left' }}>Kind</th>
            <th scope="col" style={{ textAlign: 'left' }}>Document</th>
            <th scope="col">Page</th>
            <th scope="col" style={{ textAlign: 'left' }}>Statement</th>
            <th scope="col" style={{ textAlign: 'left' }}>Unit</th>
            <th scope="col" style={{ textAlign: 'left' }}>Checked</th>
            <th scope="col">Copy down</th>
          </tr>
        </thead>
        <tbody>
          {LINE_ITEM_GROUPS.flatMap((group) => group.keys).map((key) => {
            const entry = entryFor(key);
            const hasFigure = row[key] !== null && row[key] !== undefined;
            return (
              <tr key={key} className={hasFigure ? undefined : 'is-derived'}>
                <th scope="row">
                  {HISTORICAL_FIGURE_LABELS[key]}
                  {hasFigure ? null : <span className="text-meta" style={{ display: 'block' }}>no figure entered</span>}
                </th>
                <td style={{ padding: '0 var(--space-2)' }}>
                  <select
                    aria-label={`Kind of figure for ${HISTORICAL_FIGURE_LABELS[key]}`}
                    value={entry.classification}
                    style={{ width: '100%', minHeight: 40, border: '1px solid transparent', background: 'transparent' }}
                    onChange={(event) =>
                      onChange(
                        setProvenanceField(draft, yearIndex, key, {
                          classification: event.target.value as typeof entry.classification,
                        }),
                      )
                    }
                  >
                    {CLASSIFICATION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </td>
                <td style={{ padding: '0 var(--space-2)' }}>
                  <select
                    aria-label={`Source document for ${HISTORICAL_FIGURE_LABELS[key]}`}
                    value={entry.sourceId}
                    style={{ width: '100%', minHeight: 40, border: '1px solid transparent', background: 'transparent' }}
                    onChange={(event) =>
                      onChange(setProvenanceField(draft, yearIndex, key, { sourceId: event.target.value }))
                    }
                  >
                    {sourceOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="text"
                    value={entry.page}
                    aria-label={`Page reference for ${HISTORICAL_FIGURE_LABELS[key]}`}
                    placeholder="142"
                    onChange={(event) =>
                      onChange(setProvenanceField(draft, yearIndex, key, { page: event.target.value }))
                    }
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={entry.statement}
                    aria-label={`Statement for ${HISTORICAL_FIGURE_LABELS[key]}`}
                    placeholder={statementFor(key)}
                    style={{ textAlign: 'left' }}
                    onChange={(event) =>
                      onChange(setProvenanceField(draft, yearIndex, key, { statement: event.target.value }))
                    }
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={entry.unit}
                    aria-label={`Unit for ${HISTORICAL_FIGURE_LABELS[key]}`}
                    placeholder="INR crore"
                    style={{ textAlign: 'left' }}
                    onChange={(event) =>
                      onChange(setProvenanceField(draft, yearIndex, key, { unit: event.target.value }))
                    }
                  />
                </td>
                <td style={{ padding: '0 var(--space-2)' }}>
                  <select
                    aria-label={`Verification state for ${HISTORICAL_FIGURE_LABELS[key]}`}
                    value={entry.verification}
                    style={{ width: '100%', minHeight: 40, border: '1px solid transparent', background: 'transparent' }}
                    onChange={(event) =>
                      onChange(
                        setProvenanceField(draft, yearIndex, key, {
                          verification: event.target.value as typeof entry.verification,
                        }),
                      )
                    }
                  >
                    {VERIFICATION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <Tooltip label={`Apply this document, statement and kind to every year for ${HISTORICAL_FIGURE_LABELS[key]}`}>
                    {(described) => (
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Apply this document, statement and kind to every year for ${HISTORICAL_FIGURE_LABELS[key]}`}
                        onClick={() =>
                          onChange(
                            applyProvenanceToAllYears(draft, key, {
                              sourceId: entry.sourceId,
                              statement: entry.statement || statementFor(key),
                              unit: entry.unit || draft.company.units,
                              classification: entry.classification,
                            }),
                          )
                        }
                        {...described}
                      >
                        <Copy />
                      </button>
                    )}
                  </Tooltip>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableFrame>
  );
}
