/**
 * Public viewer dashboard.
 *
 * Page pattern: Analytics / Reporting. The reader's job on this URL is to
 * explore one valuation, switch between published releases and scenarios, and
 * take the numbers away. There is nothing editable here and no write path to
 * reach: the page reads a static JSON file.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { currentSnapshot, snapshotsNewestFirst } from '../../shared/snapshot';
import type { ValuationFile, ValuationSnapshot } from '../../shared/types';
import { ApiError, errorDetails, loadPublishedData } from '../lib/api';
import { DATA_STATUS_COPY, formatCrore, formatDate, formatPerShare, formatPercent } from '../lib/format';
import { downloadForecastCsv, downloadSnapshotJson } from '../lib/download';
import { useDelayedFlag, useDismissable } from '../lib/hooks';
import { SCENARIO_ORDER, useScenarioOutcomes, useSensitivity, useValuation, type ScenarioKey } from '../lib/model';
import {
  Banner,
  Button,
  CopyButton,
  DashboardSkeleton,
  EmptyState,
  SegmentedControl,
  SelectField,
} from '../components/ui';
import { ChevronDown, Download } from '../components/icons';
import { HistoricalSection } from './public/HistoricalSection';
import { BridgeSection, CostOfCapitalSection, ForecastSection, TerminalValueSection } from './public/ModelSections';
import { MethodologySection, ScenarioSection, SensitivitySection, SourcesSection } from './public/AnalysisSections';
import { Link } from '../lib/router';

const SECTIONS = [
  { id: 'release', step: '01', label: 'Release and status' },
  { id: 'history', step: '02', label: 'Reported history' },
  { id: 'forecast', step: '03', label: 'Forecast and cash flow' },
  { id: 'cost-of-capital', step: '04', label: 'Cost of capital' },
  { id: 'terminal-value', step: '05', label: 'Discounting' },
  { id: 'bridge', step: '06', label: 'Value bridge' },
  { id: 'sensitivity', step: '07', label: 'Sensitivity' },
  { id: 'scenarios', step: '08', label: 'Scenarios' },
  { id: 'methodology', step: '09', label: 'Methodology' },
  { id: 'sources', step: '10', label: 'Sources' },
];

export function PublicDashboard() {
  const [file, setFile] = useState<ValuationFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [compareId, setCompareId] = useState<string>('');
  const [scenario, setScenario] = useState<ScenarioKey>('base');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadPublishedData();
      setFile(data);
      setSelectedId(currentSnapshot(data)?.id ?? '');
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const showSkeleton = useDelayedFlag(loading, 100);

  const snapshots = useMemo(() => (file ? snapshotsNewestFirst(file) : []), [file]);
  const snapshot = useMemo(
    () => snapshots.find((entry) => entry.id === selectedId) ?? snapshots[0] ?? null,
    [snapshots, selectedId],
  );
  const comparison = useMemo(
    () => (compareId ? (snapshots.find((entry) => entry.id === compareId) ?? null) : null),
    [snapshots, compareId],
  );

  const { result, error: modelError } = useValuation(snapshot, scenario);
  const sensitivity = useSensitivity(snapshot, scenario);
  const outcomes = useScenarioOutcomes(snapshot);

  if (loading) {
    return (
      <main className="page" id="main">
        {showSkeleton ? <DashboardSkeleton /> : null}
      </main>
    );
  }

  if (error) {
    return (
      <main className="page" id="main">
        <Banner
          tone="error"
          title="The published valuation could not be loaded"
          actions={
            <>
              <Button variant="primary" onClick={() => void load()}>Try again</Button>
              <CopyButton text={errorDetails(error, '/data/valuations.json')} />
            </>
          }
        >
          {error instanceof ApiError
            ? error.message
            : 'The data file did not come back. Check the connection and try again.'}
        </Banner>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="page" id="main">
        <div className="panel">
          <EmptyState
            title="No valuation has been published yet"
            actions={<Link className="btn btn-primary" to="/admin">Open the studio</Link>}
          >
            This site holds dated valuation snapshots. Once the first one is published from the studio, the dashboard
            shows the full model here: reported history, the forecast, the cost of capital, the value bridge and the
            source trail behind every figure.
          </EmptyState>
        </div>
      </main>
    );
  }

  const status = DATA_STATUS_COPY[snapshot.dataStatus] ?? DATA_STATUS_COPY.illustrative;

  return (
    <main className="page" id="main">
      <JumpNav />

      <section className="section" id="release" aria-labelledby="release-heading">
        <div className="section-head">
          <span className="section-step" aria-hidden="true">01</span>
          <h2 id="release-heading" className="visually-hidden">Release and status</h2>
          <h1 style={{ fontSize: 'var(--text-31)' }}>
            {snapshot.company.name}
          </h1>
        </div>

        <dl className="status-strip">
          <div className="status-item">
            <dt>Listing</dt>
            <dd>{snapshot.company.exchange}: {snapshot.company.ticker}</dd>
          </div>
          <div className="status-item">
            <dt>Sector</dt>
            <dd>{snapshot.company.sector}</dd>
          </div>
          <div className="status-item">
            <dt>Valued as of</dt>
            <dd>{formatDate(snapshot.company.valuationDate)}</dd>
          </div>
          <div className="status-item">
            <dt>Latest reported period</dt>
            <dd>{snapshot.company.reportingPeriod}, {snapshot.company.consolidationBasis.toLowerCase()}</dd>
          </div>
          <div className="status-item">
            <dt>Data status</dt>
            <dd><span className={status.className}>{status.word}</span></dd>
          </div>
        </dl>

        {snapshot.dataStatus !== 'verified' ? (
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <Banner
              tone={snapshot.dataStatus === 'illustrative' ? 'warn' : 'neutral'}
              title={
                snapshot.dataStatus === 'illustrative'
                  ? 'These figures are placeholders, not company results'
                  : 'Extraction is still in progress'
              }
            >
              {status.blurb}
            </Banner>
          </div>
        ) : null}

        <ReleaseControls
          snapshots={snapshots}
          selectedId={snapshot.id}
          compareId={compareId}
          scenario={scenario}
          onSelect={setSelectedId}
          onCompare={setCompareId}
          onScenario={setScenario}
          scenarioLabels={outcomes.map((outcome) => ({ value: outcome.key, label: outcome.label }))}
        />

        {modelError ? (
          <Banner tone="error" title="This scenario cannot be valued">
            {modelError}
          </Banner>
        ) : result ? (
          <Headline
            snapshot={snapshot}
            comparison={comparison}
            valuePerShare={result.intrinsicValuePerShare}
            enterpriseValue={result.enterpriseValue}
            equityValue={result.equityValue}
            waccPct={result.wacc.waccPct}
            terminalSharePct={result.terminalValueShareOfEnterpriseValuePct}
            scenarioLabel={outcomes.find((outcome) => outcome.key === scenario)?.label ?? 'Base'}
            onDownloadJson={() => downloadSnapshotJson(snapshot)}
            onDownloadCsv={() => downloadForecastCsv(snapshot, result)}
          />
        ) : null}

        {result && result.warnings.length > 0 ? (
          <div className="stack-3" style={{ marginTop: 'var(--space-4)' }}>
            {result.warnings.map((warning) => (
              <Banner key={warning} tone="warn" title="Read this alongside the numbers">
                {warning}
              </Banner>
            ))}
          </div>
        ) : null}

        {snapshot.company.researchNotes ? (
          <div className="panel panel-pad stack-3" style={{ marginTop: 'var(--space-6)' }}>
            <h3>Research notes</h3>
            {snapshot.company.researchNotes.split('\n\n').map((paragraph, index) => (
              <p className="text-secondary prose" key={index}>{paragraph}</p>
            ))}
          </div>
        ) : null}
      </section>

      <div className="dash-body">
        <nav className="rail" aria-label="Sections of this valuation">
          <div className="rail-inner">
            <h2>On this page</h2>
            <ol>
              {SECTIONS.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>
                    <span className="rail-index" aria-hidden="true">{section.step}</span>
                    {section.label}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>

        <div>
          <HistoricalSection snapshot={snapshot} result={result} />
          {result ? (
            <Fragment>
              <ForecastSection snapshot={snapshot} result={result} />
              <CostOfCapitalSection snapshot={snapshot} result={result} />
              <TerminalValueSection snapshot={snapshot} result={result} />
              <BridgeSection snapshot={snapshot} result={result} />
              <SensitivitySection snapshot={snapshot} grid={sensitivity} currentWaccPct={result.wacc.waccPct} />
              <ScenarioSection outcomes={outcomes} activeKey={scenario} />
              <MethodologySection snapshot={snapshot} result={result} />
            </Fragment>
          ) : null}
          <SourcesSection snapshot={snapshot} />
        </div>
      </div>
    </main>
  );
}

/** Narrow-viewport replacement for the sticky section rail. */
function JumpNav() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismissable(open, close);

  return (
    <div className="jump" ref={ref}>
      <button
        type="button"
        className="btn btn-secondary"
        aria-expanded={open}
        aria-controls="jump-panel"
        onClick={() => setOpen((current) => !current)}
      >
        Jump to section
        <ChevronDown />
      </button>
      <ul className="jump-panel" id="jump-panel" data-open={open ? 'true' : 'false'} hidden={!open}>
        {SECTIONS.map((section) => (
          <li key={section.id}>
            <a href={`#${section.id}`} onClick={close}>
              <span className="rail-index" aria-hidden="true">{section.step}</span>
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReleaseControls({
  snapshots,
  selectedId,
  compareId,
  scenario,
  onSelect,
  onCompare,
  onScenario,
  scenarioLabels,
}: {
  snapshots: ValuationSnapshot[];
  selectedId: string;
  compareId: string;
  scenario: ScenarioKey;
  onSelect: (id: string) => void;
  onCompare: (id: string) => void;
  onScenario: (key: ScenarioKey) => void;
  scenarioLabels: Array<{ value: ScenarioKey; label: string }>;
}) {
  const options = snapshots.map((entry) => ({
    value: entry.id,
    label: `${formatDate(entry.company.valuationDate)}, model ${entry.modelVersion}`,
  }));

  const ordered = SCENARIO_ORDER.map(
    (key) => scenarioLabels.find((entry) => entry.value === key) ?? { value: key, label: key },
  );

  return (
    <div className="panel panel-pad" style={{ marginBottom: 'var(--space-6)' }}>
      <div className="field-row" style={{ marginBottom: 'var(--space-4)' }}>
        <SelectField
          label="Published release"
          value={selectedId}
          options={options}
          onChange={onSelect}
          hint={
            snapshots.length === 1
              ? 'One release published so far. Each future release is kept, so they can be compared.'
              : `${snapshots.length} releases published. Earlier ones are never overwritten.`
          }
        />
        <SelectField
          label="Compare against"
          value={compareId}
          options={[
            { value: '', label: 'No comparison' },
            ...options.filter((option) => option.value !== selectedId),
          ]}
          onChange={onCompare}
          hint="Shows the change in each headline figure against an earlier release."
        />
      </div>
      <div className="btn-row">
        <SegmentedControl
          label="Scenario"
          value={scenario}
          options={ordered}
          onChange={onScenario}
        />
        <span className="text-meta">
          Switching the scenario recalculates every table on this page in the browser.
        </span>
      </div>
    </div>
  );
}

function Headline({
  snapshot,
  comparison,
  valuePerShare,
  enterpriseValue,
  equityValue,
  waccPct,
  terminalSharePct,
  scenarioLabel,
  onDownloadJson,
  onDownloadCsv,
}: {
  snapshot: ValuationSnapshot;
  comparison: ValuationSnapshot | null;
  valuePerShare: number;
  enterpriseValue: number;
  equityValue: number;
  waccPct: number;
  terminalSharePct: number;
  scenarioLabel: string;
  onDownloadJson: () => void;
  onDownloadCsv: () => void;
}) {
  const delta = (current: number, previous: number | undefined) => {
    if (previous === undefined || !Number.isFinite(previous) || previous === 0) return null;
    const change = ((current - previous) / Math.abs(previous)) * 100;
    return change;
  };

  const perShareChange = delta(valuePerShare, comparison?.results.intrinsicValuePerShare);

  const metrics = [
    {
      label: 'Enterprise value',
      value: `${formatCrore(enterpriseValue)}`,
      note: 'Present value of forecast cash flow plus terminal value.',
      change: delta(enterpriseValue, comparison?.results.enterpriseValue),
    },
    {
      label: 'Equity value',
      value: `${formatCrore(equityValue)}`,
      note: 'Enterprise value after every claim ranking ahead of equity.',
      change: delta(equityValue, comparison?.results.equityValue),
    },
    {
      label: 'Cost of capital',
      value: formatPercent(waccPct, 2),
      note: 'The rate every forecast cash flow is discounted at.',
      change: delta(waccPct, comparison?.results.waccPct),
    },
    {
      label: 'Terminal value share',
      value: formatPercent(terminalSharePct),
      note: 'How much of enterprise value comes from beyond the forecast.',
      change: delta(terminalSharePct, comparison?.results.terminalValueShareOfEnterpriseValuePct),
    },
  ];

  return (
    <div className="headline">
      <div className="headline-main">
        <p className="headline-label">Implied value per share, {scenarioLabel.toLowerCase()} case</p>
        <span className="headline-value">{formatPerShare(valuePerShare)}</span>
        <p className="headline-sub">
          What this model implies, not a market quote and not a recommendation. Figures in {snapshot.company.units}.
        </p>
        {comparison && perShareChange !== null ? (
          <p className="text-secondary" style={{ marginTop: 'var(--space-3)' }}>
            <span className={`num ${perShareChange >= 0 ? 'pos' : 'neg'}`}>
              {perShareChange >= 0 ? '+' : ''}{perShareChange.toFixed(1)}%
            </span>{' '}
            against {formatPerShare(comparison.results.intrinsicValuePerShare)} published{' '}
            {formatDate(comparison.company.valuationDate)}
          </p>
        ) : null}
        {/* Labelled rather than icon-only: two downloads with the same mark
            would be indistinguishable, and these are not toolbar chrome. */}
        <div className="btn-row" style={{ marginTop: 'var(--space-4)' }}>
          <Button variant="secondary" onClick={onDownloadJson}>
            <Download />
            Download snapshot
          </Button>
          <Button variant="secondary" onClick={onDownloadCsv}>
            <Download />
            Download forecast
          </Button>
        </div>
        <p className="text-meta" style={{ marginTop: 'var(--space-2)' }}>
          The snapshot downloads as JSON with every input and source reference. The forecast downloads as a CSV you can
          open in a spreadsheet.
        </p>
      </div>

      <dl className="metric-grid">
        {metrics.map((metric) => (
          <div className="metric" key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>{metric.value}</dd>
            {metric.change !== null ? (
              <p className="metric-note">
                <span className={metric.change >= 0 ? 'pos' : 'neg'}>
                  {metric.change >= 0 ? '+' : ''}{metric.change.toFixed(1)}%
                </span>{' '}
                against the comparison release
              </p>
            ) : (
              <p className="metric-note">{metric.note}</p>
            )}
          </div>
        ))}
      </dl>
    </div>
  );
}
