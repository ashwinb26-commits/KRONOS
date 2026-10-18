/**
 * Validate, preview, publish.
 *
 * Preview and publish are separate actions on purpose. Preview recomputes the
 * model, diffs the draft against what is live, and shows what a reader would
 * see differently. Publish is a second, named decision taken after that.
 *
 * On GitHub Pages ('static' mode) the last step is different: the same checks
 * and recalculation run in the browser, the result is downloaded as the whole
 * data file, and the panel walks the analyst through uploading it.
 *
 * The publish button is never disabled. Clicking it with blocking problems
 * lists them and jumps to the first one, which is more use than a dead control.
 */

import { useMemo, useState } from 'react';
import { diffSnapshots, valueMovements, type FieldChange } from '../../../shared/snapshot';
import { validateSnapshot } from '../../../shared/validation';
import type { PublishResponse, ValidationIssue, ValuationSnapshot } from '../../../shared/types';
import { ApiError, errorDetails } from '../../lib/api';
import { formatCrore, formatDate, formatPerShare, formatPercent } from '../../lib/format';
import { Banner, Button, ConfirmDialog, CopyButton, EmptyState, TableFrame } from '../../components/ui';
import { External } from '../../components/icons';
import { verificationSummary } from './editing';
import type { DcfResult } from '../../../shared/types';
import type { PreparedFile } from '../AdminStudio';

export function PublishPanel({
  draft,
  published,
  result,
  modelError,
  repository,
  branch,
  dataPath,
  publishConfigured,
  publishing,
  publishError,
  publishResult,
  onPublish,
  onReload,
  onGoToSection,
  mode = 'server',
  prepared = null,
  onDownloadAgain,
}: {
  draft: ValuationSnapshot;
  published: ValuationSnapshot | null;
  result: DcfResult | null;
  modelError: string | null;
  repository: string | null;
  branch: string | null;
  dataPath: string | null;
  publishConfigured: boolean;
  publishing: boolean;
  publishError: unknown;
  publishResult: PublishResponse | null;
  onPublish: () => void;
  onReload: () => void;
  onGoToSection: (section: string) => void;
  mode?: 'server' | 'static';
  prepared?: PreparedFile | null;
  onDownloadAgain?: () => void;
}) {
  const isStatic = mode === 'static';
  const actionLabel = isStatic ? 'Download updated file' : 'Publish update';
  const uploadUrl = repository
    ? `https://github.com/${repository}/upload/${encodeURIComponent(branch ?? 'main')}/${(dataPath ?? 'public/data/valuations.json')
        .split('/')
        .slice(0, -1)
        .join('/')}`
    : null;
  const [previewed, setPreviewed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showIssues, setShowIssues] = useState(false);

  const validation = useMemo(() => validateSnapshot(draft), [draft]);
  const diff = useMemo(() => diffSnapshots(published, draft), [published, draft]);
  const verification = useMemo(() => verificationSummary(draft), [draft]);

  const proposedResults = result
    ? {
        enterpriseValue: result.enterpriseValue,
        equityValue: result.equityValue,
        intrinsicValuePerShare: result.intrinsicValuePerShare,
        terminalValueShareOfEnterpriseValuePct: result.terminalValueShareOfEnterpriseValuePct,
        waccPct: result.wacc.waccPct,
      }
    : null;

  const movements = proposedResults ? valueMovements(published?.results ?? null, proposedResults) : [];
  const totalChanges =
    diff.company.length + diff.historical.length + diff.assumptions.length + diff.sources.length + diff.meta.length;

  const blocked = !validation.ok || !result;

  const attemptPublish = () => {
    if (blocked) {
      setShowIssues(true);
      // Jump to the first blocking problem rather than silently refusing.
      const first = validation.errors[0];
      if (first) onGoToSection(sectionForPath(first.path));
      return;
    }
    setConfirmOpen(true);
  };

  if (isStatic && prepared) {
    return (
      <div className="stack-6">
        <Banner
          tone="ok"
          title="valuations.json is downloaded and ready to upload"
          actions={
            <>
              {uploadUrl ? (
                <a className="btn btn-primary" href={uploadUrl} target="_blank" rel="noreferrer noopener">
                  Open the GitHub upload page <External />
                </a>
              ) : null}
              <Button variant="secondary" onClick={onDownloadAgain}>Download the file again</Button>
            </>
          }
        >
          It holds every earlier snapshot unchanged plus the new one, {prepared.snapshotId}, for{' '}
          {prepared.snapshotCount} in total. Nothing is live yet.
        </Banner>

        <section className="panel">
          <div className="panel-head">
            <h3>Put it live in 3 steps</h3>
          </div>
          <div className="panel-pad">
            <ol className="steps">
              <li>
                Open the GitHub upload page{repository ? ` for ${repository}` : ''}. It opens on the{' '}
                <code>public/data</code> folder, where the data file lives. Sign in to GitHub if it asks.
              </li>
              <li>
                Drag the <code>valuations.json</code> you just downloaded onto the page. It has the same name as the
                file already there, so it replaces it. If your browser renamed it, for example to{' '}
                <code>valuations (1).json</code>, rename it back first.
              </li>
              <li>
                Click <b>Commit changes</b>. GitHub rebuilds the site on its own and the dashboard shows the new
                release in a minute or two.
              </li>
            </ol>
          </div>
        </section>

        {prepared.mergedFrom === 'deployed' ? (
          <Banner tone="warn" title="Built from the copy deployed with the site">
            The repository file could not be read directly, so this was built from the deployed copy. If anyone
            uploaded a file in the last few minutes, wait for the site to update and prepare this again, or that
            upload will be lost.
          </Banner>
        ) : null}

        <TableFrame title="What goes live" unit={draft.company.units}>
          <table className="data">
            <caption className="visually-hidden">Results in the prepared file</caption>
            <tbody>
              <tr>
                <th scope="row">Implied value per share</th>
                <td><span className="num">{formatPerShare(prepared.results.intrinsicValuePerShare)}</span></td>
              </tr>
              <tr>
                <th scope="row">Enterprise value</th>
                <td><span className="num">{formatCrore(prepared.results.enterpriseValue)}</span></td>
              </tr>
              <tr>
                <th scope="row">Equity value</th>
                <td><span className="num">{formatCrore(prepared.results.equityValue)}</span></td>
              </tr>
              <tr>
                <th scope="row">Cost of capital used</th>
                <td><span className="num">{formatPercent(prepared.results.waccPct, 2)}</span></td>
              </tr>
            </tbody>
          </table>
        </TableFrame>

        <div className="btn-row">
          <Button variant="secondary" onClick={onReload}>Back to the studio</Button>
        </div>
      </div>
    );
  }

  if (publishResult) {
    return (
      <div className="stack-6">
        <Banner
          tone="ok"
          title={`Published ${publishResult.snapshotId}`}
          actions={
            <>
              <a className="btn btn-secondary" href={publishResult.commitUrl} target="_blank" rel="noreferrer noopener">
                View the commit <External />
              </a>
              <Button variant="primary" onClick={onReload}>Reload published data</Button>
            </>
          }
        >
          The data file was committed as {publishResult.commitSha.slice(0, 10)} and the file now holds{' '}
          {publishResult.snapshotCount} {publishResult.snapshotCount === 1 ? 'snapshot' : 'snapshots'}. Cloudflare Pages
          picks the commit up and redeploys on its own, which usually takes a minute or two. The dashboard shows the new
          release once that finishes.
        </Banner>

        <TableFrame title="What was published" unit={draft.company.units}>
          <table className="data">
            <caption className="visually-hidden">Published results</caption>
            <tbody>
              <tr>
                <th scope="row">Implied value per share</th>
                <td><span className="num">{formatPerShare(publishResult.results.intrinsicValuePerShare)}</span></td>
              </tr>
              <tr>
                <th scope="row">Enterprise value</th>
                <td><span className="num">{formatCrore(publishResult.results.enterpriseValue)}</span></td>
              </tr>
              <tr>
                <th scope="row">Equity value</th>
                <td><span className="num">{formatCrore(publishResult.results.equityValue)}</span></td>
              </tr>
              <tr>
                <th scope="row">Cost of capital used</th>
                <td><span className="num">{formatPercent(publishResult.results.waccPct, 2)}</span></td>
              </tr>
            </tbody>
          </table>
        </TableFrame>
        <p className="text-meta">
          These figures were recomputed on the server from the inputs that were submitted, not copied from this browser.
        </p>
      </div>
    );
  }

  return (
    <div className="stack-6">
      {!publishConfigured && !isStatic ? (
        <Banner tone="warn" title="Publishing is not configured on this deployment">
          Editing and previewing work, but there is no GitHub write credential set, so nothing can be committed. The
          setup guide covers adding either a GitHub App installation or a fine-grained token.
        </Banner>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <h3>Pre-publication checks</h3>
          <span className="text-meta">
            {validation.errors.length} blocking, {validation.warnings.length} to read
          </span>
        </div>
        <div className="panel-pad stack-4">
          {modelError ? (
            <Banner tone="error" title="The model does not calculate">
              {modelError}
            </Banner>
          ) : null}

          {validation.ok && validation.warnings.length === 0 && !modelError ? (
            <Banner tone="ok" title="Everything checks out">
              The draft validates, the model calculates, and nothing needs a second look.
            </Banner>
          ) : null}

          {validation.errors.length > 0 && showIssues ? (
            <Banner tone="error" title={`${validation.errors.length} ${validation.errors.length === 1 ? 'problem blocks' : 'problems block'} publication`}>
              Each one has to be fixed before this can go live.
            </Banner>
          ) : null}

          <IssueList
            issues={validation.errors}
            heading="Blocking problems"
            emptyLabel="Nothing is blocking publication."
            onGo={onGoToSection}
          />
          <IssueList
            issues={validation.warnings}
            heading="Worth reading before publishing"
            emptyLabel="No warnings."
            onGo={onGoToSection}
          />

          <div className="stack-2">
            <h4>Source trail</h4>
            <p className="text-secondary">
              {verification.reported === 0
                ? 'No figure is marked as reported yet, so there is nothing to verify. That is expected while the data is illustrative.'
                : `${verification.verified} of ${verification.reported} reported figures are verified. ${verification.missingSource} have no document and ${verification.missingPage} have no page number.`}
            </p>
            {draft.dataStatus === 'verified' && verification.verified < verification.reported ? (
              <Banner tone="error" title="This cannot be published as verified research yet">
                Every reported figure has to read Verified first. Either finish checking them, or set the data status
                back to Extracted but not fully checked.
              </Banner>
            ) : null}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Preview the update</h3>
          <span className="text-meta">{totalChanges} {totalChanges === 1 ? 'change' : 'changes'} against the published snapshot</span>
        </div>
        <div className="panel-pad stack-4">
          <p className="text-secondary prose">
            This compares the draft against{' '}
            {published ? `the snapshot published on ${formatDate(published.company.valuationDate)}` : 'nothing, since no snapshot has been published yet'}
            {' '}and recomputes every output. Nothing leaves the browser.
          </p>
          <div className="btn-row">
            <Button variant="secondary" onClick={() => setPreviewed(true)}>Preview update</Button>
            {previewed ? <span className="text-meta">Preview is up to date with the current draft.</span> : null}
          </div>
        </div>

        {previewed ? (
          <>
            {movements.length > 0 ? (
              <TableFrame title="What changes for a reader" unit={draft.company.units}>
                <table className="data">
                  <caption className="visually-hidden">Headline figures, published against proposed</caption>
                  <thead>
                    <tr>
                      <th scope="col">Figure</th>
                      <th scope="col">Published</th>
                      <th scope="col">Proposed</th>
                      <th scope="col">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((movement) => (
                      <tr key={movement.label}>
                        <th scope="row">{movement.label}</th>
                        <td>
                          <span className="num">
                            {movement.before === null ? 'nothing published' : formatNumber(movement.label, movement.before)}
                          </span>
                        </td>
                        <td><span className="num">{formatNumber(movement.label, movement.after)}</span></td>
                        <td>
                          {movement.deltaPct === null ? (
                            <span className="text-meta">first release</span>
                          ) : (
                            <span className={`num ${movement.deltaPct >= 0 ? 'pos' : 'neg'}`}>
                              {movement.deltaPct >= 0 ? '+' : ''}{movement.deltaPct.toFixed(1)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableFrame>
            ) : null}

            <DiffGroup title="Release details" changes={diff.meta} />
            <DiffGroup title="Company and reporting" changes={diff.company} />
            <DiffGroup title="Historical figures and sources" changes={diff.historical} />
            <DiffGroup title="Assumptions and scenarios" changes={diff.assumptions} />
            <DiffGroup title="Source documents" changes={diff.sources} />

            {totalChanges === 0 ? (
              <EmptyState title="Nothing has changed">
                The draft matches the published snapshot exactly. Publishing now would add a dated snapshot with
                identical figures, which is occasionally what you want after a model version bump, and usually is not.
              </EmptyState>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>{isStatic ? 'Prepare the update' : 'Publish'}</h3>
          {repository ? <span className="text-meta">{repository}, branch {branch}</span> : null}
        </div>
        <div className="panel-pad stack-4">
          {isStatic ? (
            <p className="text-secondary prose">
              This runs the same checks and recalculation a server would, appends the snapshot to the current data
              file with a fresh identifier taken from the valuation date, and downloads the result as{' '}
              <code>valuations.json</code>. Every snapshot already in the file is kept exactly as it is. Uploading that
              file to {repository ?? 'the repository'} is what puts it live, so only someone with write access to the
              repository can publish.
            </p>
          ) : (
            <p className="text-secondary prose">
              Publishing commits {dataPath ?? 'the data file'} to {repository ?? 'the configured repository'}. The
              snapshot is appended with a fresh identifier taken from the valuation date, and every snapshot already in
              the file is kept exactly as it is.
            </p>
          )}

          {publishError ? (
            <Banner
              tone="error"
              title={publishErrorTitle(publishError)}
              actions={
                <>
                  {publishError instanceof ApiError && publishError.code === 'stale_data' ? (
                    <Button variant="primary" onClick={onReload}>Reload published data</Button>
                  ) : (
                    <Button variant="primary" onClick={attemptPublish}>Try again</Button>
                  )}
                  <CopyButton text={errorDetails(publishError, '/api/publish')} />
                </>
              }
            >
              {publishError instanceof ApiError
                ? publishError.message
                : 'The request did not reach the server. Check the connection and try again.'}
            </Banner>
          ) : null}

          {publishError instanceof ApiError && publishError.issues.length > 0 ? (
            <IssueList
              issues={publishError.issues}
              heading="What the server rejected"
              emptyLabel=""
              onGo={onGoToSection}
            />
          ) : null}

          <div className="btn-row">
            <Button
              variant="primary"
              busy={publishing}
              busyLabel={isStatic ? 'Preparing' : 'Publishing'}
              onClick={attemptPublish}
            >
              {actionLabel}
            </Button>
            <span className="text-meta">
              {blocked
                ? `There are blocking problems. ${isStatic ? 'This' : 'Publishing'} will list them rather than ${isStatic ? 'producing a file' : 'committing anything'}.`
                : `You will be asked to confirm, and shown exactly what ${isStatic ? 'goes into the file' : 'gets committed'}.`}
            </span>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={confirmOpen}
        title={`${isStatic ? 'Prepare' : 'Publish'} a snapshot dated ${formatDate(draft.company.valuationDate)} for ${draft.company.ticker}?`}
        confirmLabel={actionLabel}
        busy={publishing}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          onPublish();
        }}
      >
        <p className="text-secondary">
          {isStatic
            ? 'This downloads the data file with one new snapshot appended. Nothing goes live until you upload it.'
            : `This commits ${dataPath ?? 'the data file'} to ${repository ?? 'the repository'} on branch ${branch ?? 'main'}, appending one new snapshot.`} Published snapshots are not edited or removed, so the release history stays
          intact.
        </p>

        {proposedResults ? (
          <ul className="diff">
            <li>
              <span className="diff-label">Implied value per share</span>
              <span className="diff-change diff-after">{formatPerShare(proposedResults.intrinsicValuePerShare)}</span>
            </li>
            <li>
              <span className="diff-label">Data status on the public page</span>
              <span className="diff-change diff-after">{draft.dataStatus}</span>
            </li>
            <li>
              <span className="diff-label">Changes against the published snapshot</span>
              <span className="diff-change diff-after">{totalChanges}</span>
            </li>
          </ul>
        ) : null}

        {validation.warnings.length > 0 ? (
          <Banner tone="warn" title={`${validation.warnings.length} ${validation.warnings.length === 1 ? 'warning' : 'warnings'} will be published with this`}>
            {validation.warnings.slice(0, 3).map((issue) => issue.message).join(' ')}
            {validation.warnings.length > 3 ? ` And ${validation.warnings.length - 3} more.` : ''}
          </Banner>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

function formatNumber(label: string, value: number): string {
  if (label.includes('per share')) return formatPerShare(value);
  if (label.includes('%') || label.includes('share of') || label.includes('cost of capital')) {
    return formatPercent(value, 2);
  }
  return formatCrore(value);
}

function publishErrorTitle(error: unknown): string {
  if (!(error instanceof ApiError)) return 'The update could not be sent';
  switch (error.code) {
    case 'stale_data':
      return 'The published data moved on while this was being edited';
    case 'validation':
      return 'The server rejected the update';
    case 'unacknowledged_warnings':
      return 'There are warnings to read first';
    case 'not_signed_in':
      return 'That session has ended';
    case 'not_allowed':
      return 'This account does not have studio access';
    case 'csrf':
      return 'That request could not be verified';
    case 'corrupt_data':
      return 'The data file in the repository needs fixing by hand';
    default:
      return 'The update was not published';
  }
}

/** Maps a validation path to the studio section that owns it. */
function sectionForPath(path: string): string {
  if (path.startsWith('historical')) return 'historical';
  if (path.startsWith('assumptions.bridge')) return 'bridge';
  if (path.startsWith('assumptions') || path.startsWith('scenarios') || path.startsWith('sensitivity')) {
    return 'assumptions';
  }
  return 'company';
}

function IssueList({
  issues,
  heading,
  emptyLabel,
  onGo,
}: {
  issues: ValidationIssue[];
  heading: string;
  emptyLabel: string;
  onGo: (section: string) => void;
}) {
  if (issues.length === 0) {
    return emptyLabel ? (
      <div className="stack-2">
        <h4>{heading}</h4>
        <p className="text-secondary">{emptyLabel}</p>
      </div>
    ) : null;
  }

  return (
    <div className="stack-2">
      <h4>{heading}</h4>
      <ul className="diff">
        {issues.map((issue, index) => (
          <li key={`${issue.path}-${index}`}>
            <span className="diff-label">{issue.message}</span>
            <span className="btn-row">
              <code className="diff-change">{issue.path || 'snapshot'}</code>
              <Button variant="quiet" onClick={() => onGo(sectionForPath(issue.path))}>
                Go to {sectionForPath(issue.path)}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DiffGroup({ title, changes }: { title: string; changes: FieldChange[] }) {
  const [expanded, setExpanded] = useState(false);
  if (changes.length === 0) return null;
  const shown = expanded ? changes : changes.slice(0, 8);

  return (
    <div>
      <div className="table-caption-row">
        <h4>{title}</h4>
        <span className="text-meta">{changes.length} {changes.length === 1 ? 'change' : 'changes'}</span>
      </div>
      <ul className="diff">
        {shown.map((change) => (
          <li key={change.path}>
            <span className="diff-label">{change.label}</span>
            <span className="diff-change">
              <span className="diff-before">{change.before}</span>{' '}
              <span className="diff-after">{change.after}</span>
            </span>
          </li>
        ))}
      </ul>
      {changes.length > shown.length || expanded ? (
        <div style={{ padding: 'var(--space-3) var(--space-4)' }}>
          <Button variant="quiet" onClick={() => setExpanded((current) => !current)}>
            {expanded ? `Show the first 8 changes` : `Show all ${changes.length} changes`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
