/**
 * GitHub access for reading and writing the one data file.
 *
 * The Contents API is used deliberately: it can only touch the single path it
 * is given, so a data update cannot reach a workflow file or any source file
 * even if something upstream went wrong. Writes carry the blob SHA the server
 * just read, which is how GitHub itself refuses to clobber a newer version.
 */

import { base64ToUtf8, signRs256Jwt, utf8ToBase64 } from './crypto';
import type { RepoConfig, WriteCredential } from './env';

const API = 'https://api.github.com';
const USER_AGENT = 'dcf-valuation-lab';

export class GitHubError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'GitHubError';
    this.code = code;
    this.status = status;
  }
}

function headers(token: string, accept = 'application/vnd.github+json'): HeadersInit {
  return {
    accept,
    authorization: `Bearer ${token}`,
    'user-agent': USER_AGENT,
    'x-github-api-version': '2022-11-28',
  };
}

/**
 * Exchange the configured credential for a token usable on the Contents API.
 *
 * A GitHub App installation token lives for an hour and is minted per request,
 * which is why it is preferred over a long-lived personal access token.
 */
export async function resolveWriteToken(credential: WriteCredential): Promise<string> {
  if (credential.kind === 'token') return credential.token;

  const now = Math.floor(Date.now() / 1000);
  const jwt = await signRs256Jwt(credential.privateKeyPem, {
    // 60 seconds of backdating absorbs clock skew between the edge and GitHub.
    iat: now - 60,
    exp: now + 540,
    iss: credential.appId,
  });

  const response = await fetch(
    `${API}/app/installations/${encodeURIComponent(credential.installationId)}/access_tokens`,
    { method: 'POST', headers: headers(jwt) },
  );

  if (!response.ok) {
    throw new GitHubError(
      'app_token',
      response.status,
      'GitHub refused to issue an installation token. Check the App id, installation id and private key.',
    );
  }

  const body = (await response.json()) as { token?: string };
  if (!body.token) {
    throw new GitHubError('app_token', 502, 'GitHub returned an installation response without a token.');
  }
  return body.token;
}

export interface DataFileState {
  /** File contents as text, or null when the file does not exist yet. */
  content: string | null;
  /** Blob SHA, needed to update the file. Null when creating it. */
  sha: string | null;
}

/**
 * Read the data file and its SHA.
 *
 * Files over 1 MB come back from the Contents API with an empty body, so the
 * blob is fetched directly in that case. Without this, a data file that grew
 * past the limit would silently read as empty and the next publish would drop
 * every earlier snapshot.
 */
export async function readDataFile(repo: RepoConfig, token: string): Promise<DataFileState> {
  const url = `${API}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/contents/${repo.dataPath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}?ref=${encodeURIComponent(repo.branch)}`;

  const response = await fetch(url, {
    headers: { ...(headers(token) as Record<string, string>), 'cache-control': 'no-store' },
  });

  if (response.status === 404) return { content: null, sha: null };
  if (!response.ok) {
    throw new GitHubError(
      'read_failed',
      response.status,
      response.status === 401 || response.status === 403
        ? 'GitHub refused to read the data file. Check that the credential still has Contents access to this repository.'
        : 'GitHub could not return the current data file. Try again in a moment.',
    );
  }

  const body = (await response.json()) as {
    sha?: string;
    content?: string;
    encoding?: string;
    type?: string;
    size?: number;
  };

  if (body.type !== 'file' || !body.sha) {
    throw new GitHubError('read_failed', 502, 'The configured data path does not point at a file.');
  }

  if (body.encoding === 'base64' && body.content) {
    return { content: base64ToUtf8(body.content), sha: body.sha };
  }

  // Large file: the Contents API omitted the body, so read the blob instead.
  const blobResponse = await fetch(
    `${API}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/git/blobs/${body.sha}`,
    { headers: headers(token, 'application/vnd.github.raw') },
  );
  if (!blobResponse.ok) {
    throw new GitHubError(
      'read_failed',
      blobResponse.status,
      'GitHub could not return the current data file. Try again in a moment.',
    );
  }
  return { content: await blobResponse.text(), sha: body.sha };
}

export interface WriteResult {
  commitSha: string;
  commitUrl: string;
  fileSha: string;
}

export async function writeDataFile(
  repo: RepoConfig,
  token: string,
  input: { content: string; sha: string | null; message: string },
): Promise<WriteResult> {
  const url = `${API}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/contents/${repo.dataPath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: { ...(headers(token) as Record<string, string>), 'content-type': 'application/json' },
    body: JSON.stringify({
      message: input.message,
      content: utf8ToBase64(input.content),
      branch: repo.branch,
      ...(input.sha ? { sha: input.sha } : {}),
    }),
  });

  if (response.status === 409 || response.status === 422) {
    throw new GitHubError(
      'stale_data',
      409,
      'The data file changed in GitHub while this update was being prepared. Reload the studio so it picks up the published version, then publish again.',
    );
  }

  if (!response.ok) {
    throw new GitHubError(
      'write_failed',
      response.status,
      response.status === 401 || response.status === 403
        ? 'GitHub refused the commit. Check that the credential still has Contents write access to this repository and branch.'
        : 'GitHub could not accept the commit. Try again in a moment.',
    );
  }

  const body = (await response.json()) as {
    commit?: { sha?: string; html_url?: string };
    content?: { sha?: string };
  };

  if (!body.commit?.sha) {
    throw new GitHubError('write_failed', 502, 'GitHub accepted the write but returned no commit reference.');
  }

  return {
    commitSha: body.commit.sha,
    commitUrl:
      body.commit.html_url ??
      `https://github.com/${repo.owner}/${repo.repo}/commit/${body.commit.sha}`,
    fileSha: body.content?.sha ?? '',
  };
}

export interface GitHubProfile {
  login: string;
  id: number;
  avatarUrl: string;
}

/** Trade an OAuth code for a user access token. The token is used once, here. */
export async function exchangeOauthCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<string> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': USER_AGENT },
    body: JSON.stringify({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
  });

  if (!response.ok) {
    throw new GitHubError('oauth_exchange', response.status, 'GitHub could not complete the sign-in. Try again.');
  }

  const body = (await response.json()) as { access_token?: string; error?: string };
  if (!body.access_token) {
    // body.error is GitHub's machine code, for example bad_verification_code.
    throw new GitHubError(
      'oauth_exchange',
      400,
      'That sign-in link has already been used or has expired. Start again from the sign-in page.',
    );
  }
  return body.access_token;
}

export async function fetchGitHubProfile(userToken: string): Promise<GitHubProfile> {
  const response = await fetch(`${API}/user`, { headers: headers(userToken) });
  if (!response.ok) {
    throw new GitHubError('oauth_profile', response.status, 'GitHub could not confirm who signed in. Try again.');
  }
  const body = (await response.json()) as { login?: string; id?: number; avatar_url?: string };
  if (!body.login || typeof body.id !== 'number') {
    throw new GitHubError('oauth_profile', 502, 'GitHub returned an incomplete profile. Try again.');
  }
  return { login: body.login, id: body.id, avatarUrl: body.avatar_url ?? '' };
}
