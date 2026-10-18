/**
 * GitHub client tests, against a stubbed fetch.
 *
 * The cases that matter are the ones that would otherwise fail silently: a
 * data file over 1 MB that the Contents API returns with an empty body, a
 * rejected stale SHA, and non-ASCII text that plain btoa would corrupt.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubError, exchangeOauthCode, fetchGitHubProfile, readDataFile, writeDataFile } from '../functions/_lib/github';
import { base64ToUtf8, utf8ToBase64 } from '../functions/_lib/crypto';
import type { RepoConfig } from '../functions/_lib/env';

const repo: RepoConfig = {
  owner: 'owner',
  repo: 'repo',
  branch: 'main',
  dataPath: 'public/data/valuations.json',
};

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function stubFetch(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readDataFile', () => {
  it('decodes a base64 body and returns the blob SHA', async () => {
    const content = '{"schemaVersion":2}';
    stubFetch(() => json({ type: 'file', sha: 'blob-sha', encoding: 'base64', content: utf8ToBase64(content) }));

    const state = await readDataFile(repo, 'token');
    expect(state.content).toBe(content);
    expect(state.sha).toBe('blob-sha');
  });

  it('asks for the configured branch and encodes the path safely', async () => {
    const calls = stubFetch(() => json({ type: 'file', sha: 's', encoding: 'base64', content: utf8ToBase64('{}') }));
    await readDataFile(repo, 'token');
    expect(calls[0].url).toBe(
      'https://api.github.com/repos/owner/repo/contents/public/data/valuations.json?ref=main',
    );
  });

  it('sends the token and a user agent, which GitHub requires', async () => {
    const calls = stubFetch(() => json({ type: 'file', sha: 's', encoding: 'base64', content: utf8ToBase64('{}') }));
    await readDataFile(repo, 'secret-token');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer secret-token');
    expect(headers['user-agent']).toBe('dcf-valuation-lab');
  });

  it('treats a missing file as nothing published yet', async () => {
    stubFetch(() => new Response(null, { status: 404 }));
    expect(await readDataFile(repo, 'token')).toEqual({ content: null, sha: null });
  });

  it('falls back to the blob API when the file is too large for the Contents API', async () => {
    const big = '{"schemaVersion":2,"big":true}';
    const calls = stubFetch((call) => {
      if (call.url.includes('/git/blobs/')) return new Response(big, { status: 200 });
      // Over 1 MB, GitHub returns the metadata with an empty content field.
      return json({ type: 'file', sha: 'blob-sha', encoding: 'none', content: '', size: 2_000_000 });
    });

    const state = await readDataFile(repo, 'token');
    expect(state.content).toBe(big);
    expect(state.sha).toBe('blob-sha');
    expect(calls[1].url).toBe('https://api.github.com/repos/owner/repo/git/blobs/blob-sha');
  });

  it('reports a credential problem in words the analyst can act on', async () => {
    stubFetch(() => json({ message: 'Bad credentials' }, 401));
    await expect(readDataFile(repo, 'token')).rejects.toThrow(/Contents access/);
  });

  it('refuses a path that points at a directory', async () => {
    stubFetch(() => json([{ name: 'a.json' }]));
    await expect(readDataFile(repo, 'token')).rejects.toThrow(/does not point at a file/);
  });
});

describe('writeDataFile', () => {
  it('commits with the SHA, branch and message it was given', async () => {
    const calls = stubFetch(() =>
      json({ commit: { sha: 'commit-sha', html_url: 'https://github.com/owner/repo/commit/commit-sha' }, content: { sha: 'next-blob' } }),
    );

    const result = await writeDataFile(repo, 'token', {
      content: '{"a":1}',
      sha: 'old-blob',
      message: 'data: publish',
    });

    expect(result.commitSha).toBe('commit-sha');
    expect(result.fileSha).toBe('next-blob');
    expect(calls[0].init?.method).toBe('PUT');

    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toMatchObject({ message: 'data: publish', branch: 'main', sha: 'old-blob' });
    expect(base64ToUtf8(body.content)).toBe('{"a":1}');
  });

  it('omits the SHA when creating the file, which is how GitHub tells the two apart', async () => {
    const calls = stubFetch(() => json({ commit: { sha: 'c' } }));
    await writeDataFile(repo, 'token', { content: '{}', sha: null, message: 'create' });
    expect(JSON.parse(String(calls[0].init?.body))).not.toHaveProperty('sha');
  });

  it('encodes non-ASCII content without corrupting it', async () => {
    const calls = stubFetch(() => json({ commit: { sha: 'c' } }));
    const content = '{"units":"₹ crore","note":"margins held — see page 142"}';
    await writeDataFile(repo, 'token', { content, sha: 'x', message: 'm' });
    expect(base64ToUtf8(JSON.parse(String(calls[0].init?.body)).content)).toBe(content);
  });

  it('turns a rejected stale SHA into a reload instruction', async () => {
    stubFetch(() => json({ message: 'is at ... but expected ...' }, 409));
    try {
      await writeDataFile(repo, 'token', { content: '{}', sha: 'stale', message: 'm' });
      throw new Error('expected a GitHubError');
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubError);
      expect((error as GitHubError).code).toBe('stale_data');
      expect((error as GitHubError).message).toMatch(/Reload the studio/);
    }
  });

  it('treats a 422 the same way, since GitHub uses it for the same conflict', async () => {
    stubFetch(() => json({ message: 'Invalid request' }, 422));
    await expect(writeDataFile(repo, 'token', { content: '{}', sha: 'stale', message: 'm' })).rejects.toThrow(
      /changed in GitHub/,
    );
  });

  it('reports a missing permission without echoing the upstream body', async () => {
    stubFetch(() => json({ message: 'Resource not accessible by integration' }, 403));
    try {
      await writeDataFile(repo, 'token', { content: '{}', sha: 'x', message: 'm' });
      throw new Error('expected a GitHubError');
    } catch (error) {
      expect((error as Error).message).toMatch(/Contents write access/);
      expect((error as Error).message).not.toMatch(/integration/);
    }
  });

  it('refuses to report success when GitHub returns no commit', async () => {
    stubFetch(() => json({ content: { sha: 'x' } }));
    await expect(writeDataFile(repo, 'token', { content: '{}', sha: 'x', message: 'm' })).rejects.toThrow(
      /no commit reference/,
    );
  });
});

describe('OAuth exchange', () => {
  it('posts the code and returns the access token', async () => {
    const calls = stubFetch(() => json({ access_token: 'gho_token' }));
    const token = await exchangeOauthCode({
      clientId: 'id',
      clientSecret: 'secret',
      code: 'code',
      redirectUri: 'https://lab.example.com/api/auth/callback',
    });
    expect(token).toBe('gho_token');
    expect(calls[0].url).toBe('https://github.com/login/oauth/access_token');
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ client_id: 'id', code: 'code' });
  });

  it('turns a reused code into an instruction, not GitHub’s error string', async () => {
    stubFetch(() => json({ error: 'bad_verification_code' }));
    try {
      await exchangeOauthCode({ clientId: 'id', clientSecret: 'secret', code: 'used', redirectUri: 'https://x/y' });
      throw new Error('expected a GitHubError');
    } catch (error) {
      expect((error as Error).message).toMatch(/already been used|expired/);
      expect((error as Error).message).not.toMatch(/bad_verification_code/);
    }
  });

  it('never puts the client secret in the error', async () => {
    stubFetch(() => json({ error: 'incorrect_client_credentials' }));
    try {
      await exchangeOauthCode({ clientId: 'id', clientSecret: 'the-secret', code: 'c', redirectUri: 'https://x/y' });
    } catch (error) {
      expect((error as Error).message).not.toContain('the-secret');
    }
  });
});

describe('profile lookup', () => {
  it('returns the login and numeric id', async () => {
    stubFetch(() => json({ login: 'analyst-one', id: 42, avatar_url: 'https://avatars.githubusercontent.com/u/42' }));
    expect(await fetchGitHubProfile('token')).toEqual({
      login: 'analyst-one',
      id: 42,
      avatarUrl: 'https://avatars.githubusercontent.com/u/42',
    });
  });

  it('refuses an incomplete profile rather than inventing a login', async () => {
    stubFetch(() => json({ login: 'analyst-one' }));
    await expect(fetchGitHubProfile('token')).rejects.toThrow(/incomplete profile/);
  });

  it('reports a failed lookup', async () => {
    stubFetch(() => json({ message: 'Bad credentials' }, 401));
    await expect(fetchGitHubProfile('token')).rejects.toThrow(/could not confirm/);
  });
});
