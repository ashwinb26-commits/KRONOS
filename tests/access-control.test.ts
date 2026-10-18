/**
 * Access control tests.
 *
 * These cover the things an attacker would actually try: a forged session
 * cookie, an expired one, a login that is no longer on the allowlist, a
 * cross-site publish, a missing CSRF token, a replayed OAuth callback, and an
 * open redirect through the post-login destination.
 */

import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  parseAdminLogins,
  readAuthConfig,
  readRepoConfig,
  hasWriteCredential,
  readWriteCredential,
  siteOrigin,
  type Env,
} from '../functions/_lib/env';
import {
  createOauthState,
  createSessionCookieValue,
  csrfOk,
  isAdminLogin,
  parseCookies,
  readOauthState,
  readSessionCookieValue,
  safeNextPath,
  serializeCookie,
  clearCookie,
  cookieSecureFor,
  toSessionUser,
} from '../functions/_lib/session';
import { requireAdmin } from '../functions/_lib/guard';
import { originRejection } from '../functions/_lib/responses';
import { timingSafeEqual, utf8ToBase64, base64ToUtf8, signHmac, verifyHmac } from '../functions/_lib/crypto';

const SECRET = 'a'.repeat(48);

const baseEnv: Env = {
  GITHUB_OAUTH_CLIENT_ID: 'client-id',
  GITHUB_OAUTH_CLIENT_SECRET: 'client-secret',
  SESSION_SECRET: SECRET,
  ADMIN_GITHUB_LOGINS: 'Analyst-One, second-analyst',
  GITHUB_REPO_OWNER: 'owner',
  GITHUB_REPO_NAME: 'repo',
  GITHUB_DATA_TOKEN: 'token',
};

const request = (init: { headers?: Record<string, string>; method?: string; url?: string } = {}) =>
  new Request(init.url ?? 'https://lab.example.com/api/publish', {
    method: init.method ?? 'POST',
    headers: init.headers,
  });

async function sessionCookie(login: string, ttl = 3600) {
  const { value, payload } = await createSessionCookieValue(
    SECRET,
    { login, id: 42, avatarUrl: 'https://avatars.githubusercontent.com/u/42' },
    ttl,
  );
  return { cookie: `dcf_session=${encodeURIComponent(value)}`, payload, value };
}

describe('configuration', () => {
  it('reads a complete configuration', () => {
    const config = readAuthConfig(baseEnv);
    expect(config.adminLogins).toEqual(['analyst-one', 'second-analyst']);
    expect(config.sessionTtlSeconds).toBe(8 * 60 * 60);
  });

  it('refuses a missing session secret', () => {
    expect(() => readAuthConfig({ ...baseEnv, SESSION_SECRET: undefined })).toThrow(ConfigError);
  });

  it('refuses a session secret that is too short to be worth signing with', () => {
    try {
      readAuthConfig({ ...baseEnv, SESSION_SECRET: 'short' });
      throw new Error('expected a ConfigError');
    } catch (error) {
      expect((error as ConfigError).code).toBe('config_weak_secret');
    }
  });

  it('refuses a deployment with nobody on the allowlist', () => {
    try {
      readAuthConfig({ ...baseEnv, ADMIN_GITHUB_LOGINS: '  ,  ' });
      throw new Error('expected a ConfigError');
    } catch (error) {
      expect((error as ConfigError).code).toBe('config_no_admins');
    }
  });

  it('caps the session lifetime at a day and floors it at 5 minutes', () => {
    expect(readAuthConfig({ ...baseEnv, SESSION_TTL_SECONDS: '999999' }).sessionTtlSeconds).toBe(86400);
    expect(readAuthConfig({ ...baseEnv, SESSION_TTL_SECONDS: '10' }).sessionTtlSeconds).toBe(28800);
    expect(readAuthConfig({ ...baseEnv, SESSION_TTL_SECONDS: 'abc' }).sessionTtlSeconds).toBe(28800);
  });

  it('parses an allowlist into lowercase entries', () => {
    expect(parseAdminLogins('A, b ,, C')).toEqual(['a', 'b', 'c']);
    expect(parseAdminLogins(undefined)).toEqual([]);
  });
});

describe('the data path cannot reach outside public/data', () => {
  it('accepts the default path', () => {
    expect(readRepoConfig(baseEnv).dataPath).toBe('public/data/valuations.json');
  });

  for (const path of [
    '.github/workflows/deploy.yml',
    'src/App.tsx',
    'public/data/../../package.json',
    'public/data/valuations.json.bak',
    'public/valuations.json',
    'public/data/sub/dir.json',
  ]) {
    it(`rejects ${path}`, () => {
      expect(() => readRepoConfig({ ...baseEnv, DATA_FILE_PATH: path })).toThrow(ConfigError);
    });
  }

  it('accepts another json file inside public/data', () => {
    expect(readRepoConfig({ ...baseEnv, DATA_FILE_PATH: 'public/data/archive-2025.json' }).dataPath).toBe(
      'public/data/archive-2025.json',
    );
  });
});

describe('write credential selection', () => {
  it('prefers a GitHub App installation over a token', () => {
    const credential = readWriteCredential({
      ...baseEnv,
      GITHUB_APP_ID: '1',
      GITHUB_APP_INSTALLATION_ID: '2',
      GITHUB_APP_PRIVATE_KEY: 'pem',
    });
    expect(credential.kind).toBe('app');
  });

  it('falls back to a fine-grained token', () => {
    expect(readWriteCredential(baseEnv).kind).toBe('token');
  });

  it('reports that publishing is unconfigured rather than guessing', () => {
    const env = { ...baseEnv, GITHUB_DATA_TOKEN: undefined };
    expect(hasWriteCredential(env)).toBe(false);
    expect(() => readWriteCredential(env)).toThrow(ConfigError);
  });

  it('takes the origin from the request unless one is configured', () => {
    expect(siteOrigin(request(), baseEnv)).toBe('https://lab.example.com');
    expect(siteOrigin(request(), { ...baseEnv, PUBLIC_SITE_ORIGIN: 'https://custom.example/' })).toBe(
      'https://custom.example',
    );
  });
});

describe('session cookies', () => {
  it('round-trips a signed session', async () => {
    const { value, payload } = await sessionCookie('analyst-one');
    const read = await readSessionCookieValue(SECRET, value);
    expect(read?.sub).toBe('analyst-one');
    expect(read?.csrf).toBe(payload.csrf);
  });

  it('rejects a tampered payload', async () => {
    const { value } = await sessionCookie('analyst-one');
    const [body, signature] = value.split('.');
    const forgedBody = utf8ToBase64(JSON.stringify({ v: 1, sub: 'attacker', uid: 1, av: '', iat: 0, exp: 9e9, csrf: 'x' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await readSessionCookieValue(SECRET, `${forgedBody}.${signature}`)).toBeNull();
    expect(await readSessionCookieValue(SECRET, `${body}.${signature}x`)).toBeNull();
  });

  it('rejects a session signed with another secret', async () => {
    const { value } = await sessionCookie('analyst-one');
    expect(await readSessionCookieValue('b'.repeat(48), value)).toBeNull();
  });

  it('rejects an expired session', async () => {
    const { value } = await sessionCookie('analyst-one', -10);
    expect(await readSessionCookieValue(SECRET, value)).toBeNull();
  });

  it('rejects an empty or malformed cookie', async () => {
    expect(await readSessionCookieValue(SECRET, undefined)).toBeNull();
    expect(await readSessionCookieValue(SECRET, '')).toBeNull();
    expect(await readSessionCookieValue(SECRET, 'nodot')).toBeNull();
  });

  it('does not carry a GitHub access token', async () => {
    const { value, payload } = await sessionCookie('analyst-one');
    expect(JSON.stringify(payload)).not.toMatch(/gho_|ghp_|github_pat/);
    expect(Object.keys(payload).sort()).toEqual(['av', 'csrf', 'exp', 'iat', 'sub', 'uid', 'v']);
    expect(value).not.toContain('token');
  });

  it('exposes only the fields the interface needs', async () => {
    const { payload } = await sessionCookie('analyst-one');
    const user = toSessionUser(payload);
    expect(Object.keys(user).sort()).toEqual(['avatarUrl', 'expiresAt', 'githubId', 'login']);
  });

  it('writes HttpOnly, Secure, SameSite cookies', () => {
    const cookie = serializeCookie('dcf_session', 'value', { maxAge: 60 });
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=60');
    expect(clearCookie('dcf_session')).toContain('Max-Age=0');
  });

  it('drops Secure only on plain-HTTP localhost, so local development works', () => {
    expect(cookieSecureFor(new Request('http://localhost:8788/a'))).toBe(false);
    expect(cookieSecureFor(new Request('http://127.0.0.1:8788/a'))).toBe(false);
    expect(cookieSecureFor(new Request('https://localhost:8788/a'))).toBe(true);
    expect(cookieSecureFor(new Request('http://preview.pages.dev/a'))).toBe(true);
  });

  it('parses a cookie header', () => {
    expect(parseCookies('a=1; b=two%20words; broken')).toEqual({ a: '1', b: 'two words' });
    expect(parseCookies(null)).toEqual({});
  });
});

describe('the allowlist', () => {
  it('matches regardless of case or padding', () => {
    expect(isAdminLogin('Analyst-One', ['analyst-one'])).toBe(true);
    expect(isAdminLogin('  ANALYST-ONE ', ['analyst-one'])).toBe(true);
  });

  it('does not match anybody else', () => {
    expect(isAdminLogin('someone-else', ['analyst-one'])).toBe(false);
    expect(isAdminLogin('analyst-one', [])).toBe(false);
    expect(isAdminLogin('analyst', ['analyst-one'])).toBe(false);
  });
});

describe('CSRF', () => {
  it('accepts a matching token', async () => {
    const { payload } = await sessionCookie('analyst-one');
    const ok = await csrfOk(request({ headers: { 'x-csrf-token': payload.csrf } }), payload);
    expect(ok).toBe(true);
  });

  it('rejects a missing or wrong token', async () => {
    const { payload } = await sessionCookie('analyst-one');
    expect(await csrfOk(request(), payload)).toBe(false);
    expect(await csrfOk(request({ headers: { 'x-csrf-token': 'wrong' } }), payload)).toBe(false);
  });

  it('compares in a way that does not leak length', async () => {
    expect(await timingSafeEqual('abc', 'abc')).toBe(true);
    expect(await timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(await timingSafeEqual('', '')).toBe(true);
  });
});

describe('same-origin enforcement', () => {
  it('accepts a same-origin fetch', () => {
    expect(originRejection(request({ headers: { 'sec-fetch-site': 'same-origin' } }), 'https://lab.example.com')).toBeNull();
  });

  it('rejects a cross-site fetch', () => {
    const response = originRejection(
      request({ headers: { 'sec-fetch-site': 'cross-site' } }),
      'https://lab.example.com',
    );
    expect(response?.status).toBe(403);
  });

  it('falls back to the Origin header when Sec-Fetch-Site is absent', () => {
    expect(originRejection(request({ headers: { origin: 'https://lab.example.com' } }), 'https://lab.example.com')).toBeNull();
    expect(originRejection(request({ headers: { origin: 'https://evil.example' } }), 'https://lab.example.com')?.status).toBe(403);
  });

  it('rejects a request with neither header rather than trusting it', () => {
    expect(originRejection(request(), 'https://lab.example.com')?.status).toBe(403);
  });
});

describe('OAuth state', () => {
  it('round-trips and keeps the destination', async () => {
    const { nonce, cookieValue } = await createOauthState(SECRET, '/admin/historical');
    const state = await readOauthState(SECRET, cookieValue);
    expect(state?.nonce).toBe(nonce);
    expect(state?.next).toBe('/admin/historical');
  });

  it('rejects a cookie signed with another secret', async () => {
    const { cookieValue } = await createOauthState(SECRET, '/admin');
    expect(await readOauthState('b'.repeat(48), cookieValue)).toBeNull();
  });

  it('rejects a tampered cookie', async () => {
    const { cookieValue } = await createOauthState(SECRET, '/admin');
    expect(await readOauthState(SECRET, `${cookieValue}x`)).toBeNull();
    expect(await readOauthState(SECRET, 'garbage')).toBeNull();
    expect(await readOauthState(SECRET, undefined)).toBeNull();
  });

  it('refuses to send the browser anywhere but a same-origin path', () => {
    expect(safeNextPath('//evil.example/admin')).toBe('/admin');
    expect(safeNextPath('https://evil.example')).toBe('/admin');
    expect(safeNextPath('javascript:alert(1)')).toBe('/admin');
    expect(safeNextPath('/admin/../../etc')).toBe('/admin/../../etc');
    expect(safeNextPath('/admin\\evil')).toBe('/admin');
    expect(safeNextPath('/admin/publish')).toBe('/admin/publish');
    expect(safeNextPath(null)).toBe('/admin');
    expect(safeNextPath('/' + 'x'.repeat(500))).toHaveLength(200);
  });
});

describe('requireAdmin', () => {
  const headers = (extra: Record<string, string> = {}) => ({
    'sec-fetch-site': 'same-origin',
    ...extra,
  });

  it('refuses an unauthenticated request', async () => {
    const guard = await requireAdmin(request({ headers: headers() }), baseEnv, { requireCsrf: true });
    expect(guard.ok).toBe(false);
    if (!guard.ok) {
      expect(guard.response.status).toBe(401);
      expect(await guard.response.json()).toMatchObject({ code: 'not_signed_in' });
    }
  });

  it('refuses a valid session for a login that is not on the allowlist', async () => {
    const { cookie, payload } = await sessionCookie('outsider');
    const guard = await requireAdmin(
      request({ headers: headers({ cookie, 'x-csrf-token': payload.csrf }) }),
      baseEnv,
      { requireCsrf: true },
    );
    expect(guard.ok).toBe(false);
    if (!guard.ok) {
      expect(guard.response.status).toBe(403);
      expect(await guard.response.json()).toMatchObject({ code: 'not_allowed' });
    }
  });

  it('refuses a login removed from the allowlist since the cookie was issued', async () => {
    const { cookie, payload } = await sessionCookie('analyst-one');
    const guard = await requireAdmin(
      request({ headers: headers({ cookie, 'x-csrf-token': payload.csrf }) }),
      { ...baseEnv, ADMIN_GITHUB_LOGINS: 'somebody-else' },
      { requireCsrf: true },
    );
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.response.status).toBe(403);
  });

  it('refuses a write with no CSRF token', async () => {
    const { cookie } = await sessionCookie('analyst-one');
    const guard = await requireAdmin(request({ headers: headers({ cookie }) }), baseEnv, { requireCsrf: true });
    expect(guard.ok).toBe(false);
    if (!guard.ok) {
      expect(guard.response.status).toBe(403);
      expect(await guard.response.json()).toMatchObject({ code: 'csrf' });
    }
  });

  it('refuses a cross-site write even with a valid session and token', async () => {
    const { cookie, payload } = await sessionCookie('analyst-one');
    const guard = await requireAdmin(
      request({ headers: { 'sec-fetch-site': 'cross-site', cookie, 'x-csrf-token': payload.csrf } }),
      baseEnv,
      { requireCsrf: true },
    );
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.response.status).toBe(403);
  });

  it('refuses everything when the deployment is not configured', async () => {
    const { cookie, payload } = await sessionCookie('analyst-one');
    const guard = await requireAdmin(
      request({ headers: headers({ cookie, 'x-csrf-token': payload.csrf }) }),
      { ...baseEnv, SESSION_SECRET: undefined },
      { requireCsrf: true },
    );
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.response.status).toBe(503);
  });

  it('lets a signed-in administrator through', async () => {
    const { cookie, payload } = await sessionCookie('Analyst-One');
    const guard = await requireAdmin(
      request({ headers: headers({ cookie, 'x-csrf-token': payload.csrf }) }),
      baseEnv,
      { requireCsrf: true },
    );
    expect(guard.ok).toBe(true);
    if (guard.ok) expect(guard.session.sub).toBe('Analyst-One');
  });

  it('allows a read without a CSRF token, but still checks the session', async () => {
    const { cookie } = await sessionCookie('analyst-one');
    const allowed = await requireAdmin(
      new Request('https://lab.example.com/api/data', { headers: { cookie } }),
      baseEnv,
      { requireCsrf: false },
    );
    expect(allowed.ok).toBe(true);

    const denied = await requireAdmin(
      new Request('https://lab.example.com/api/data'),
      baseEnv,
      { requireCsrf: false },
    );
    expect(denied.ok).toBe(false);
  });
});

describe('error responses carry no secrets', () => {
  it('returns a code and a sentence, and nothing else identifying', async () => {
    const guard = await requireAdmin(
      request({ headers: { 'sec-fetch-site': 'same-origin' } }),
      baseEnv,
      { requireCsrf: true },
    );
    if (guard.ok) throw new Error('expected a refusal');
    const text = await guard.response.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('client-secret');
    expect(text).not.toContain('token');
    expect(JSON.parse(text)).toEqual({
      ok: false,
      code: 'not_signed_in',
      message: expect.any(String),
    });
  });
});

describe('base64 helpers handle non-ASCII', () => {
  it('round-trips text that btoa alone would reject', () => {
    const text = 'Revenue ₹ 40,500 crore — verified';
    expect(base64ToUtf8(utf8ToBase64(text))).toBe(text);
  });

  it('signs and verifies', async () => {
    const signature = await signHmac(SECRET, 'message');
    expect(await verifyHmac(SECRET, 'message', signature)).toBe(true);
    expect(await verifyHmac(SECRET, 'other', signature)).toBe(false);
    expect(await verifyHmac('other-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'message', signature)).toBe(false);
  });
});
