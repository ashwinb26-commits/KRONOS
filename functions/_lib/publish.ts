/**
 * Publication logic, kept free of Request and Response so it can be driven
 * directly by tests.
 *
 * Two decisions here matter more than the rest:
 *
 *  1. The server recomputes every output from the submitted inputs and stores
 *     its own numbers. Whatever results the browser sent are discarded, so a
 *     tampered or stale client cannot publish figures that do not follow from
 *     the assumptions.
 *  2. The snapshot id is assigned by the server from the valuation date, and
 *     the write carries the blob SHA the server itself just read. An update
 *     prepared against an older version of the file is refused rather than
 *     overwriting whatever landed in the meantime.
 */

import { calculateDcf } from '../../shared/dcf';
import {
  appendSnapshot,
  createSnapshotId,
  currentSnapshot,
  SnapshotMergeError,
} from '../../shared/snapshot';
import {
  MAX_PAYLOAD_BYTES,
  isValuationFile,
  sanitizeSnapshot,
  validateSnapshot,
} from '../../shared/validation';
import { emptyValuationFile } from '../../shared/snapshot';
import type { ValidationIssue, ValuationFile, ValuationSnapshot } from '../../shared/types';
import type { DataFileState, WriteResult } from './github';

/** Refuse to write a data file larger than this, whatever the payload said. */
export const MAX_DATA_FILE_BYTES = 2 * 1024 * 1024;

export interface PublishRequest {
  /** Snapshot as submitted. Treated as untrusted until it passes validation. */
  snapshot: unknown;
  /** Blob SHA the studio read when it loaded. Null when it saw no file. */
  baseFileSha: string | null;
  /** The analyst has seen the warnings and still wants to publish. */
  acknowledgeWarnings: boolean;
}

export interface PublishDeps {
  readFile: () => Promise<DataFileState>;
  writeFile: (input: { content: string; sha: string | null; message: string }) => Promise<WriteResult>;
  publishedBy: string;
  now?: () => Date;
}

export type PublishOutcome =
  | {
      ok: true;
      status: 200;
      commitSha: string;
      commitUrl: string;
      snapshotId: string;
      snapshotCount: number;
      results: ValuationSnapshot['results'];
      warnings: ValidationIssue[];
    }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      issues?: ValidationIssue[];
    };

export async function publishSnapshot(
  request: PublishRequest,
  deps: PublishDeps,
): Promise<PublishOutcome> {
  const now = deps.now ?? (() => new Date());

  const validation = validateSnapshot(request.snapshot);
  if (!validation.ok) {
    return {
      ok: false,
      status: 422,
      code: 'validation',
      message: `This snapshot has ${validation.errors.length} ${
        validation.errors.length === 1 ? 'problem' : 'problems'
      } that block publication. Fix them and publish again.`,
      issues: validation.errors,
    };
  }

  if (validation.warnings.length > 0 && !request.acknowledgeWarnings) {
    return {
      ok: false,
      status: 409,
      code: 'unacknowledged_warnings',
      message: `There ${validation.warnings.length === 1 ? 'is' : 'are'} ${
        validation.warnings.length
      } ${validation.warnings.length === 1 ? 'warning' : 'warnings'} to read before this goes live.`,
      issues: validation.warnings,
    };
  }

  const submitted = request.snapshot as ValuationSnapshot;

  // Read the published file first, so the merge and the write both work from
  // the same version.
  let state: DataFileState;
  try {
    state = await deps.readFile();
  } catch (error) {
    return {
      ok: false,
      status: 502,
      code: 'read_failed',
      message:
        error instanceof Error
          ? error.message
          : 'The current data file could not be read from GitHub. Try again in a moment.',
    };
  }

  if (request.baseFileSha && state.sha && request.baseFileSha !== state.sha) {
    return {
      ok: false,
      status: 409,
      code: 'stale_data',
      message:
        'The data file changed in GitHub since the studio loaded. Reload so it picks up the published version, then publish again.',
    };
  }

  let existing: ValuationFile;
  if (state.content === null || state.content.trim() === '') {
    existing = emptyValuationFile();
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(state.content);
    } catch {
      return {
        ok: false,
        status: 409,
        code: 'corrupt_data',
        message:
          'The data file in GitHub is not valid JSON, so nothing was changed. Fix the file in the repository before publishing again.',
      };
    }
    if (!isValuationFile(parsed)) {
      return {
        ok: false,
        status: 409,
        code: 'corrupt_data',
        message:
          'The data file in GitHub does not match the snapshot schema, so nothing was changed. Fix the file in the repository before publishing again.',
      };
    }
    existing = parsed;
  }

  // Server-side recalculation. The browser's numbers are not used.
  let results: ValuationSnapshot['results'];
  try {
    const run = calculateDcf(submitted.historical, submitted.assumptions);
    results = {
      enterpriseValue: run.enterpriseValue,
      equityValue: run.equityValue,
      intrinsicValuePerShare: run.intrinsicValuePerShare,
      terminalValueShareOfEnterpriseValuePct: run.terminalValueShareOfEnterpriseValuePct,
      waccPct: run.wacc.waccPct,
    };
  } catch (error) {
    return {
      ok: false,
      status: 422,
      code: 'model_error',
      message:
        error instanceof Error
          ? error.message
          : 'The model could not be calculated from these assumptions.',
    };
  }

  const snapshotId = createSnapshotId(
    submitted.company.valuationDate,
    existing.snapshots.map((snapshot) => snapshot.id),
  );

  const snapshot = sanitizeSnapshot({
    ...submitted,
    id: snapshotId,
    createdAt: now().toISOString(),
    publishedBy: deps.publishedBy,
    results,
    commitSha: undefined,
  });

  let merged: ValuationFile;
  try {
    merged = appendSnapshot(existing, snapshot);
  } catch (error) {
    if (error instanceof SnapshotMergeError) {
      return { ok: false, status: 409, code: error.code, message: error.message };
    }
    throw error;
  }

  const content = `${JSON.stringify(merged, null, 2)}\n`;
  const byteLength = new TextEncoder().encode(content).byteLength;
  if (byteLength > MAX_DATA_FILE_BYTES) {
    return {
      ok: false,
      status: 413,
      code: 'file_too_large',
      message:
        'Adding this snapshot would push the data file past its size limit. Archive the oldest releases into a separate file first.',
    };
  }

  const previous = currentSnapshot(existing);
  const message =
    `data: publish ${snapshot.id} for ${snapshot.company.ticker}\n\n` +
    `Valuation date: ${snapshot.company.valuationDate}\n` +
    `Data status: ${snapshot.dataStatus}\n` +
    `Model version: ${snapshot.modelVersion}\n` +
    `Value per share: ${results.intrinsicValuePerShare}` +
    (previous ? ` (previously ${previous.results.intrinsicValuePerShare})` : '') +
    `\nPublished by: ${deps.publishedBy}\n`;

  let write: WriteResult;
  try {
    write = await deps.writeFile({ content, sha: state.sha, message });
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'write_failed';
    return {
      ok: false,
      status: code === 'stale_data' ? 409 : 502,
      code,
      message:
        error instanceof Error
          ? error.message
          : 'GitHub could not accept the commit. Try again in a moment.',
    };
  }

  return {
    ok: true,
    status: 200,
    commitSha: write.commitSha,
    commitUrl: write.commitUrl,
    snapshotId: snapshot.id,
    snapshotCount: merged.snapshots.length,
    results,
    warnings: validation.warnings,
  };
}

/** Read a JSON body with a hard size cap applied before parsing. */
export async function readJsonBody(request: Request): Promise<
  { ok: true; value: unknown } | { ok: false; code: string; message: string }
> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_PAYLOAD_BYTES) {
    return {
      ok: false,
      code: 'payload_too_large',
      message: 'That update is larger than the server accepts. Remove unused historical years or sources.',
    };
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_PAYLOAD_BYTES) {
    return {
      ok: false,
      code: 'payload_too_large',
      message: 'That update is larger than the server accepts. Remove unused historical years or sources.',
    };
  }

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, code: 'bad_json', message: 'The update could not be read. Reload the studio and try again.' };
  }
}
