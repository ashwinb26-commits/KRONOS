/**
 * Publish a snapshot: validate on the server, recompute the model on the
 * server, append to the data file, and commit it.
 *
 * Nothing the browser sends is trusted. The payload is re-validated with the
 * same rules the studio ran, the outputs are recalculated from the submitted
 * inputs, and the commit carries the blob SHA this request read rather than one
 * the client supplied.
 */

import { readRepoConfig, readWriteCredential, ConfigError, type Env } from '../_lib/env';
import { GitHubError, readDataFile, resolveWriteToken, writeDataFile } from '../_lib/github';
import { apiError, json, unexpected } from '../_lib/responses';
import { requireAdmin } from '../_lib/guard';
import { publishSnapshot, readJsonBody } from '../_lib/publish';
import type { PublishResponse } from '../../shared/types';

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return apiError(405, 'method_not_allowed', 'Publish with a POST request.');
  }

  const guard = await requireAdmin(request, env, { requireCsrf: true });
  if (!guard.ok) return guard.response;

  const body = await readJsonBody(request);
  if (!body.ok) return apiError(413, body.code, body.message);

  const payload = body.value as {
    snapshot?: unknown;
    baseFileSha?: unknown;
    acknowledgeWarnings?: unknown;
  };

  if (typeof payload !== 'object' || payload === null || !('snapshot' in payload)) {
    return apiError(400, 'bad_request', 'That update was missing its snapshot. Reload the studio and try again.');
  }

  try {
    const repo = readRepoConfig(env);
    const token = await resolveWriteToken(readWriteCredential(env));

    const outcome = await publishSnapshot(
      {
        snapshot: payload.snapshot,
        baseFileSha: typeof payload.baseFileSha === 'string' ? payload.baseFileSha : null,
        acknowledgeWarnings: payload.acknowledgeWarnings === true,
      },
      {
        publishedBy: guard.session.sub,
        readFile: () => readDataFile(repo, token),
        writeFile: (input) => writeDataFile(repo, token, input),
      },
    );

    if (!outcome.ok) {
      return apiError(outcome.status, outcome.code, outcome.message, { issues: outcome.issues });
    }

    const response: PublishResponse = {
      ok: true,
      commitSha: outcome.commitSha,
      commitUrl: outcome.commitUrl,
      snapshotId: outcome.snapshotId,
      snapshotCount: outcome.snapshotCount,
      results: outcome.results,
    };
    return json(response);
  } catch (error) {
    if (error instanceof ConfigError) return apiError(503, error.code, error.message);
    if (error instanceof GitHubError) return apiError(502, error.code, error.message);
    return unexpected('api/publish', error);
  }
};
