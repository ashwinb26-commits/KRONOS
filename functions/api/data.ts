/**
 * The live data file, straight from GitHub, for the studio only.
 *
 * The public dashboard reads the static /data/valuations.json that ships with
 * the deployment. The studio needs something stronger: the version that is in
 * the repository right now, plus its blob SHA. Cloudflare Pages takes a minute
 * or two to rebuild after a commit, and during that window the deployed copy is
 * behind. Editing against the live copy is what makes the stale-write check
 * meaningful.
 */

import { readRepoConfig, readWriteCredential, ConfigError, type Env } from '../_lib/env';
import { GitHubError, readDataFile, resolveWriteToken } from '../_lib/github';
import { apiError, json, unexpected } from '../_lib/responses';
import { requireAdmin } from '../_lib/guard';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const guard = await requireAdmin(request, env, { requireCsrf: false });
  if (!guard.ok) return guard.response;

  try {
    const repo = readRepoConfig(env);
    const token = await resolveWriteToken(readWriteCredential(env));
    const state = await readDataFile(repo, token);

    return json({
      ok: true,
      sha: state.sha,
      path: repo.dataPath,
      branch: repo.branch,
      repository: `${repo.owner}/${repo.repo}`,
      file: state.content === null ? null : (JSON.parse(state.content) as unknown),
    });
  } catch (error) {
    if (error instanceof ConfigError) return apiError(503, error.code, error.message);
    if (error instanceof GitHubError) return apiError(502, error.code, error.message);
    if (error instanceof SyntaxError) {
      return apiError(
        409,
        'corrupt_data',
        'The data file in GitHub is not valid JSON. Fix it in the repository before editing here.',
      );
    }
    return unexpected('api/data', error);
  }
};
