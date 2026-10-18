/**
 * Company, reporting basis, dates and source documents.
 */

import { useState } from 'react';
import type { DataStatus, SourceDocument, ValuationSnapshot } from '../../../shared/types';
import {
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  SelectField,
  TextAreaField,
  TextField,
} from '../../components/ui';

const FY_HINT = 'Write it as FY2024-25.';
const DATE_HINT = 'Use the format 2026-04-30.';

const STATUS_OPTIONS: Array<{ value: DataStatus; label: string }> = [
  { value: 'illustrative', label: 'Illustrative placeholders, not company data' },
  { value: 'in-review', label: 'Extracted but not fully checked' },
  { value: 'verified', label: 'Every reported figure verified against its source' },
];

const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
const isFy = (value: string) => /^FY\d{4}-\d{2}$/.test(value.trim());

export function CompanyPanel({
  draft,
  onChange,
}: {
  draft: ValuationSnapshot;
  onChange: (next: ValuationSnapshot) => void;
}) {
  const company = draft.company;

  const setCompany = (patch: Partial<ValuationSnapshot['company']>) =>
    onChange({ ...draft, company: { ...company, ...patch } });

  return (
    <div className="stack-6">
      <section className="panel">
        <div className="panel-head">
          <h3>Company and listing</h3>
        </div>
        <div className="panel-pad stack-4">
          <div className="field-row">
            <TextField
              label="Company name"
              value={company.name}
              onChange={(name) => setCompany({ name })}
              required
              maxLength={120}
              validate={(value) => (value.trim() ? null : 'Enter the company name.')}
              hint="As printed on the annual report."
            />
            <TextField
              label="Ticker"
              value={company.ticker}
              onChange={(ticker) => setCompany({ ticker: ticker.toUpperCase() })}
              required
              maxLength={20}
              placeholder="ASIANPAINT"
              validate={(value) =>
                /^[A-Z0-9.&-]{1,20}$/.test(value.trim().toUpperCase())
                  ? null
                  : 'Use capital letters, numbers, dots, ampersands or hyphens.'
              }
            />
          </div>
          <div className="field-row">
            <TextField
              label="Exchange"
              value={company.exchange}
              onChange={(exchange) => setCompany({ exchange })}
              required
              maxLength={40}
              placeholder="NSE"
              validate={(value) => (value.trim() ? null : 'Enter the exchange.')}
            />
            <TextField
              label="Sector"
              value={company.sector}
              onChange={(sector) => setCompany({ sector })}
              required
              maxLength={80}
              validate={(value) => (value.trim() ? null : 'Enter the sector.')}
            />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Reporting basis</h3>
          <span className="text-meta">Applies to every figure in this snapshot</span>
        </div>
        <div className="panel-pad stack-4">
          <div className="field-row">
            <SelectField
              label="Consolidation basis"
              value={company.consolidationBasis}
              options={[
                { value: 'Consolidated', label: 'Consolidated' },
                { value: 'Standalone', label: 'Standalone' },
              ]}
              onChange={(consolidationBasis) => setCompany({ consolidationBasis })}
              hint="Never mix the two inside one historical series."
            />
            <TextField
              label="Currency"
              value={company.currency}
              onChange={(currency) => setCompany({ currency: currency.toUpperCase().slice(0, 3) })}
              required
              maxLength={3}
              placeholder="INR"
              validate={(value) => (/^[A-Z]{3}$/.test(value.trim()) ? null : 'Use a 3 letter code such as INR.')}
            />
          </div>
          <div className="field-row">
            <TextField
              label="Reporting unit"
              value={company.units}
              onChange={(units) => setCompany({ units })}
              required
              maxLength={60}
              placeholder="INR crore, except per-share figures"
              validate={(value) => (value.trim() ? null : 'State the unit every figure is entered in.')}
              hint="Shown beside every table on the dashboard."
            />
            <TextField
              label="Financial year end"
              value={company.fiscalYearEnd}
              onChange={(fiscalYearEnd) => setCompany({ fiscalYearEnd })}
              required
              maxLength={20}
              placeholder="31 March"
              validate={(value) => (value.trim() ? null : 'Enter the financial year end.')}
            />
          </div>
          <div className="field-row">
            <TextField
              label="Latest reported period"
              value={company.reportingPeriod}
              onChange={(reportingPeriod) => setCompany({ reportingPeriod })}
              required
              maxLength={12}
              placeholder="FY2024-25"
              hint={FY_HINT}
              validate={(value) => (isFy(value) ? null : 'Write the period as FY2024-25.')}
            />
            <SelectField
              label="Data status"
              value={draft.dataStatus}
              options={STATUS_OPTIONS}
              onChange={(dataStatus) => onChange({ ...draft, dataStatus })}
              hint="Verified can only be published once every reported line is checked."
            />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Dates and version</h3>
        </div>
        <div className="panel-pad stack-4">
          <div className="field-row">
            <TextField
              label="Valuation date"
              value={company.valuationDate}
              onChange={(valuationDate) => setCompany({ valuationDate })}
              required
              maxLength={10}
              placeholder="2026-04-30"
              hint={`${DATE_HINT} The snapshot identifier is built from this date.`}
              validate={(value) => (isIsoDate(value) ? null : 'Use the format 2026-04-30.')}
            />
            <TextField
              label="Publication date"
              value={company.publicationDate}
              onChange={(publicationDate) => setCompany({ publicationDate })}
              required
              maxLength={10}
              placeholder="2026-04-30"
              hint={DATE_HINT}
              validate={(value) => (isIsoDate(value) ? null : 'Use the format 2026-04-30.')}
            />
          </div>
          <div className="field-row">
            <TextField
              label="Model version"
              value={draft.modelVersion}
              onChange={(modelVersion) => onChange({ ...draft, modelVersion })}
              required
              maxLength={16}
              placeholder="1.1.0"
              hint="Raise it whenever the method changes, not when the figures change."
              validate={(value) => (/^\d+\.\d+\.\d+$/.test(value.trim()) ? null : 'Write the version as 1.1.0.')}
            />
          </div>
          <TextAreaField
            label="Publication notes"
            value={draft.publicationNotes}
            onChange={(publicationNotes) => onChange({ ...draft, publicationNotes })}
            maxLength={1200}
            hint="What changed in this release and why. Shown in the commit message and the release history."
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Research notes</h3>
          <span className="text-meta">Shown on the public dashboard</span>
        </div>
        <div className="panel-pad">
          <TextAreaField
            label="Notes for the reader"
            value={company.researchNotes}
            onChange={(researchNotes) => setCompany({ researchNotes })}
            maxLength={4000}
            rows={10}
            hint="Blank lines separate paragraphs. Record the observation date for market-derived inputs here."
          />
        </div>
      </section>

      <SourcesEditor draft={draft} onChange={onChange} />
    </div>
  );
}

function SourcesEditor({
  draft,
  onChange,
}: {
  draft: ValuationSnapshot;
  onChange: (next: ValuationSnapshot) => void;
}) {
  const [pendingRemoval, setPendingRemoval] = useState<SourceDocument | null>(null);

  const setSource = (index: number, patch: Partial<SourceDocument>) => {
    const sources = draft.sources.map((source, i) => (i === index ? { ...source, ...patch } : source));
    onChange({ ...draft, sources });
  };

  const addSource = () => {
    const today = new Date().toISOString().slice(0, 10);
    const id = `annual-report-${draft.sources.length + 1}`;
    onChange({
      ...draft,
      sources: [
        ...draft.sources,
        { id, label: '', url: '', reportYear: draft.company.reportingPeriod, retrievedOn: today, notes: '' },
      ],
    });
  };

  const removeSource = (source: SourceDocument) => {
    // Any figure pointing at this document loses its link, so it goes back to
    // unlinked rather than keeping a reference that no longer resolves.
    const historical = draft.historical.map((row) => ({
      ...row,
      provenance: Object.fromEntries(
        Object.entries(row.provenance ?? {}).map(([key, entry]) => [
          key,
          entry && entry.sourceId === source.id ? { ...entry, sourceId: '' } : entry,
        ]),
      ) as ValuationSnapshot['historical'][number]['provenance'],
    }));
    onChange({ ...draft, sources: draft.sources.filter((item) => item.id !== source.id), historical });
    setPendingRemoval(null);
  };

  const usageCount = (id: string) =>
    draft.historical.reduce(
      (total, row) =>
        total + Object.values(row.provenance ?? {}).filter((entry) => entry?.sourceId === id).length,
      0,
    );

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Source documents</h3>
        <Button variant="secondary" onClick={addSource}>Add source document</Button>
      </div>

      {draft.sources.length === 0 ? (
        <EmptyState
          title="No source documents yet"
          actions={<Button variant="primary" onClick={addSource}>Add source document</Button>}
        >
          Every reported figure has to point at a document. Add the consolidated annual reports you are extracting
          from, then attach each figure to one in the Historical data section.
        </EmptyState>
      ) : (
        <div className="panel-pad stack-6">
          {draft.sources.map((source, index) => (
            <div key={source.id} className="stack-4" style={{
              paddingBottom: 'var(--space-4)',
              borderBottom: index < draft.sources.length - 1 ? '1px solid var(--hairline)' : undefined,
            }}>
              <div className="field-row">
                <TextField
                  label="Reference id"
                  value={source.id}
                  onChange={(id) => setSource(index, { id: id.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                  required
                  maxLength={64}
                  placeholder="annual-report-fy2024-25"
                  hint="Lowercase letters, numbers and hyphens. Figures reference this."
                  validate={(value) =>
                    /^[a-z0-9][a-z0-9-]{0,63}$/.test(value.trim()) ? null : 'Use lowercase letters, numbers and hyphens.'
                  }
                />
                <TextField
                  label="Report year"
                  value={source.reportYear}
                  onChange={(reportYear) => setSource(index, { reportYear })}
                  required
                  maxLength={12}
                  placeholder="FY2024-25"
                  hint={FY_HINT}
                  validate={(value) => (isFy(value) ? null : 'Write the year as FY2024-25.')}
                />
              </div>
              <TextField
                label="Document title"
                value={source.label}
                onChange={(label) => setSource(index, { label })}
                required
                maxLength={160}
                validate={(value) => (value.trim() ? null : 'Enter the document title.')}
              />
              <div className="field-row">
                <TextField
                  label="Link"
                  value={source.url}
                  onChange={(url) => setSource(index, { url })}
                  required
                  maxLength={500}
                  inputMode="url"
                  placeholder="https://example.com/annual-report.pdf"
                  validate={(value) =>
                    /^https?:\/\/[^\s]+$/i.test(value.trim()) ? null : 'Links must start with http:// or https://.'
                  }
                />
                <TextField
                  label="Date retrieved"
                  value={source.retrievedOn}
                  onChange={(retrievedOn) => setSource(index, { retrievedOn })}
                  required
                  maxLength={10}
                  placeholder="2026-04-30"
                  hint={DATE_HINT}
                  validate={(value) => (isIsoDate(value) ? null : 'Use the format 2026-04-30.')}
                />
              </div>
              <TextAreaField
                label="Notes"
                value={source.notes ?? ''}
                onChange={(notes) => setSource(index, { notes })}
                maxLength={400}
                rows={3}
                hint="Restatements, scope changes or anything that affects comparability."
              />
              <div className="btn-row">
                <span className="text-meta">
                  {usageCount(source.id) === 0
                    ? 'No figures reference this document yet.'
                    : `${usageCount(source.id)} figures reference this document.`}
                </span>
                <Button variant="quiet" onClick={() => setPendingRemoval(source)}>Remove source document</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingRemoval !== null}
        title={`Remove source document "${pendingRemoval?.label || pendingRemoval?.id || ''}"?`}
        confirmLabel="Remove source document"
        tone="danger"
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => pendingRemoval && removeSource(pendingRemoval)}
      >
        <Banner tone="warn" title="What this changes in the draft">
          {pendingRemoval && usageCount(pendingRemoval.id) > 0
            ? `${usageCount(pendingRemoval.id)} figures currently point at this document. They stay in the draft but go back to having no source, which will stop the snapshot being published as verified research.`
            : 'Nothing references this document, so only the entry itself is removed.'}
        </Banner>
        <p className="text-secondary">
          This only changes the draft in this browser. Nothing published is touched until you publish again.
        </p>
      </ConfirmDialog>
    </section>
  );
}
