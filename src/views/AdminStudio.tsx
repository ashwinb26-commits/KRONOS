/**
 * Admin and model engine studio.
 *
 * Page pattern: Form, long edit. Five sections, each with its own route so a
 * refresh or a shared link lands back in the same place, and a pinned status
 * bar so the live model output is visible from every section.
 *
 * The studio edits against the repository's current data file rather than the
 * copy baked into this deployment, and holds the blob SHA it read. That SHA
 * goes up with the publish, so an update prepared against an older version is
 * refused instead of overwriting whatever landed in between.
 *
 * Everything here is convenience. The server checks the session, the
 * allowlist and the CSRF token again on every write, and recomputes the model
 * itself, so none of this interface is load-bearing for security.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { currentSnapshot } from '../../shared/snapshot';
import type { PublishResponse, SessionResponse, ValuationFile, ValuationSnapshot } from '../../shared/types';
import { ApiError, errorDetails, getLiveData, loadPublishedData, publishSnapshot } from '../lib/api';
import { formatCrore, formatDate, formatPerShare, formatPercent } from '../lib/format';
import { useDelayedFlag, useDraft } from '../lib/hooks';
import { useValuation } from '../lib/model';
import { Link, useRoute } from '../lib/router';
import { Banner, Button, CopyButton, DashboardSkeleton, EmptyState } from '../components/ui';
import { CompanyPanel } from './admin/CompanyPanel';
import { HistoricalPanel } from './admin/HistoricalPanel';
import { AssumptionsPanel } from './admin/AssumptionsPanel';
import { BridgePanel } from './admin/BridgePanel';
import { PublishPanel } from './admin/PublishPanel';
import { draftFromPublished } from './admin/editing';

type SectionKey = 'company' | 'historical' | 'assumptions' | 'bridge' | 'publish';

const SECTIONS: Array<{ key: SectionKey; step: string; label: string; path: string }> = [
  { key: 'company', step: '01', label: 'Company and sources', path: '/admin' },
  { key: 'historical', step: '02', label: 'Historical data', path: '/admin/historical' },
  { key: 'assumptions', step: '03', label: 'Assumptions', path: '/admin/assumptions' },
  { key: 'bridge', step: '04', label: 'Equity bridge', path: '/admin/bridge' },
  { key: 'publish', step: '05', label: 'Validate and publish', path: '/admin/publish' },
];

function sectionFromPath(path: string): SectionKey {
  const match = SECTIONS.find((section) => section.path === path);
  return match?.key ?? 'company';
}

interface LoadedData {
  file: ValuationFile | null;
  sha: string | null;
  repository: string | null;
  branch: string | null;
  dataPath: string | null;
  /** True when the studio is editing the deployed copy, not the live repository. */
  degraded: boolean;
}

export function AdminStudio({
  session,
  sessionLoaded,
  onSessionChange,
}: {
  session: SessionResponse | null;
  sessionLoaded: boolean;
  onSessionChange: () => void;
}) {
  const { path, navigate } = useRoute();
  const section = sectionFromPath(path);

  const [data, setData] = useState<LoadedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<unknown>(null);
  const [publishResult, setPublishResult] = useState<PublishResponse | null>(null);

  const authenticated = session?.authenticated === true;

  // Protected route, as a convenience. The server refuses the data and the
  // publish endpoint regardless of what this does.
  useEffect(() => {
    if (sessionLoaded && !authenticated) {
      navigate(`/login?next=${encodeURIComponent(path)}`, { replace: true });
    }
  }, [sessionLoaded, authenticated, navigate, path]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const live = await getLiveData();
      setData({
        file: live.file,
        sha: live.sha,
        repository: live.repository,
        branch: live.branch,
        dataPath: live.path,
        degraded: false,
      });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.code === 'not_signed_in')) {
        onSessionChange();
        navigate('/login?error=session_expired', { replace: true });
        return;
      }
      // The repository may not be configured yet. Editing and previewing are
      // still worth having, so fall back to the deployed copy and say so.
      try {
        const published = await loadPublishedData();
        setData({
          file: published,
          sha: null,
          repository: null,
          branch: null,
          dataPath: null,
          degraded: true,
        });
        setLoadError(error);
      } catch (fallbackError) {
        setLoadError(fallbackError);
      }
    } finally {
      setLoading(false);
    }
  }, [navigate, onSessionChange]);

  useEffect(() => {
    if (authenticated) void load();
  }, [authenticated, load]);

  const published = useMemo(() => (data?.file ? currentSnapshot(data.file) : null), [data]);
  const today = new Date().toISOString().slice(0, 10);

  const draftKey = data?.repository ? `${data.repository}:${data.dataPath}` : 'local';
  const seed = useMemo(
    () => (published ? draftFromPublished(published, today) : null),
    [published, today],
  );

  const draft = useDraft<ValuationSnapshot | null>(draftKey, seed, authenticated);

  // Adopt the published snapshot once it arrives, if nothing has been drafted.
  useEffect(() => {
    if (!draft.value && seed) draft.setValue(seed);
  }, [draft, seed]);

  const current = draft.value;
  const { result, error: modelError } = useValuation(current, 'base');
  const showSkeleton = useDelayedFlag(loading, 100);

  const onPublish = useCallback(async () => {
    if (!current || !session?.csrfToken) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const response = await publishSnapshot({
        snapshot: current,
        baseFileSha: data?.sha ?? null,
        // The dialog showed the warnings before this ran. The server enforces
        // the same rule independently for any direct API call.
        acknowledgeWarnings: true,
        csrfToken: session.csrfToken,
      });
      setPublishResult(response);
      draft.clear();
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.code === 'not_signed_in')) {
        onSessionChange();
        navigate('/login?error=session_expired', { replace: true });
        return;
      }
      setPublishError(error);
    } finally {
      setPublishing(false);
    }
  }, [current, session, data, draft, navigate, onSessionChange]);

  if (!sessionLoaded || (loading && authenticated)) {
    return (
      <main className="page" id="main">
        {showSkeleton || !sessionLoaded ? <DashboardSkeleton /> : null}
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="page" id="main">
        <div className="panel">
          <EmptyState
            title="Sign in to open the studio"
            actions={<Link className="btn btn-primary" to={`/login?next=${encodeURIComponent(path)}`}>Sign in with GitHub</Link>}
          >
            The studio edits the financial data and publishes it. Access is decided on the server against a fixed list
            of GitHub logins, so there is nothing to see here until you sign in.
          </EmptyState>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="page" id="main">
        <Banner
          tone="error"
          title="The valuation data could not be loaded"
          actions={
            <>
              <Button variant="primary" onClick={() => void load()}>Try again</Button>
              <CopyButton text={errorDetails(loadError, '/api/data')} />
            </>
          }
        >
          {loadError instanceof ApiError
            ? loadError.message
            : 'Neither the repository copy nor the deployed copy came back. Check the connection and try again.'}
        </Banner>
      </main>
    );
  }

  if (!current) {
    return (
      <main className="page" id="main">
        <div className="panel">
          <EmptyState
            title="No snapshot to start from"
            actions={<Button variant="primary" onClick={() => void load()}>Reload</Button>}
          >
            Nothing has been published yet and no draft is saved in this browser, so there is no starting point. Reload
            to pick up the repository copy, or seed the data file by running the seed script locally.
          </EmptyState>
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="page" id="main">
        <div className="section-head" style={{ marginBottom: 'var(--space-2)' }}>
          <h1 style={{ fontSize: 'var(--text-31)' }}>Model engine studio</h1>
        </div>
        <p className="section-note">
          {data.degraded
            ? 'Editing the copy deployed with this site, because the repository could not be reached.'
            : `Editing against ${data.repository}, branch ${data.branch}. ${
                published ? `Last published ${formatDate(published.company.valuationDate)}.` : 'Nothing published yet.'
              }`}
        </p>

        <div className="stack-4" style={{ marginBottom: 'var(--space-6)' }}>
          {data.degraded && loadError ? (
            <Banner
              tone="warn"
              title="Editing the deployed copy, not the repository"
              actions={<Button variant="secondary" onClick={() => void load()}>Try the repository again</Button>}
            >
              {loadError instanceof ApiError
                ? loadError.message
                : 'The repository data file could not be read.'}{' '}
              Changes can still be previewed, and publishing will check the live file before it writes.
            </Banner>
          ) : null}

          {draft.restoredAt ? (
            <Banner
              tone="neutral"
              title="A saved draft was restored"
              actions={
                <Button
                  variant="secondary"
                  onClick={() => {
                    draft.discard();
                    void load();
                  }}
                >
                  Discard draft and start from the published snapshot
                </Button>
              }
            >
              Last edited {new Date(draft.restoredAt).toLocaleString('en-IN')}. Drafts are kept in this browser only and
              hold the financial data being prepared for publication, nothing else.
            </Banner>
          ) : null}
        </div>

        <div className="studio">
          <nav className="studio-nav" aria-label="Studio sections">
            <ol>
              {SECTIONS.map((entry) => (
                <li key={entry.key}>
                  <Link to={entry.path} aria-current={section === entry.key ? 'page' : undefined}>
                    <span className="studio-step" aria-hidden="true">{entry.step}</span>
                    {entry.label}
                  </Link>
                </li>
              ))}
            </ol>
          </nav>

          <div>
            {section === 'company' ? <CompanyPanel draft={current} onChange={draft.setValue} /> : null}
            {section === 'historical' ? <HistoricalPanel draft={current} onChange={draft.setValue} /> : null}
            {section === 'assumptions' ? <AssumptionsPanel draft={current} onChange={draft.setValue} /> : null}
            {section === 'bridge' ? (
              <BridgePanel
                draft={current}
                onChange={draft.setValue}
                enterpriseValue={result?.enterpriseValue ?? null}
              />
            ) : null}
            {section === 'publish' ? (
              <PublishPanel
                draft={current}
                published={published}
                result={result}
                modelError={modelError}
                repository={data.repository}
                branch={data.branch}
                dataPath={data.dataPath}
                publishConfigured={session?.publishConfigured === true && !data.degraded}
                publishing={publishing}
                publishError={publishError}
                publishResult={publishResult}
                onPublish={() => void onPublish()}
                onReload={() => {
                  setPublishResult(null);
                  setPublishError(null);
                  void load();
                }}
                onGoToSection={(key) => {
                  const target = SECTIONS.find((entry) => entry.key === key);
                  if (target) navigate(target.path);
                }}
              />
            ) : null}
          </div>
        </div>
      </main>

      <StatusBar
        result={result}
        modelError={modelError}
        draft={current}
        published={published}
        section={section}
      />
    </>
  );
}

function StatusBar({
  result,
  modelError,
  draft,
  published,
  section,
}: {
  result: ReturnType<typeof useValuation>['result'];
  modelError: string | null;
  draft: ValuationSnapshot;
  published: ValuationSnapshot | null;
  section: SectionKey;
}) {
  const perShareChange =
    result && published && published.results.intrinsicValuePerShare !== 0
      ? ((result.intrinsicValuePerShare - published.results.intrinsicValuePerShare) /
          Math.abs(published.results.intrinsicValuePerShare)) *
        100
      : null;

  return (
    <div className="statusbar" role="status" aria-live="polite" aria-label="Live model output">
      <div className="statusbar-inner">
        {modelError ? (
          <span className="statusbar-metric">
            <span>Model</span>
            <b className="neg">does not calculate</b>
          </span>
        ) : result ? (
          <>
            <span className="statusbar-metric">
              <span>Value per share</span>
              <b>{formatPerShare(result.intrinsicValuePerShare)}</b>
              {perShareChange !== null ? (
                <b className={perShareChange >= 0 ? 'pos' : 'neg'}>
                  {perShareChange >= 0 ? '+' : ''}{perShareChange.toFixed(1)}%
                </b>
              ) : null}
            </span>
            <span className="statusbar-metric">
              <span>Enterprise value</span>
              <b>{formatCrore(result.enterpriseValue)}</b>
            </span>
            <span className="statusbar-metric">
              <span>Equity value</span>
              <b>{formatCrore(result.equityValue)}</b>
            </span>
            <span className="statusbar-metric">
              <span>Cost of capital</span>
              <b>{formatPercent(result.wacc.waccPct, 2)}</b>
            </span>
            <span className="statusbar-metric">
              <span>Terminal share</span>
              <b>{formatPercent(result.terminalValueShareOfEnterpriseValuePct)}</b>
            </span>
          </>
        ) : null}

        <span className="chrome-spacer" />

        {section === 'publish' ? null : (
          <Link to="/admin/publish" className="btn btn-secondary">
            Review and publish
          </Link>
        )}
        <span className="text-meta">{draft.dataStatus}</span>
      </div>
    </div>
  );
}
