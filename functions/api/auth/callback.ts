/**
 * Completes the GitHub OAuth flow.
 *
 * Order matters here. The state is checked before the code is spent, the
 * allowlist is checked before any session is issued, and a login that is not
 * on the allowlist leaves with no cookie at all. Every failure sends the
 * browser back to the sign-in page with a code it can turn into a sentence,
 * and never with an upstream error body.
 */

import { ConfigError, readAuthConfig, siteOrigin, type Env } from '../../_lib/env';
import { exchangeOauthCode, fetchGitHubProfile, GitHubError } from '../../_lib/github';
import { redirect } from '../../_lib/responses';
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  clearCookie,
  cookieSecureFor,
  createSessionCookieValue,
  isAdminLogin,
  parseCookies,
  readOauthState,
  serializeCookie,
} from '../../_lib/session';
import { timingSafeEqual } from '../../_lib/crypto';

const back = (code: string) => redirect(`/login?error=${encodeURIComponent(code)}`);

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  let config;
  try {
    config = readAuthConfig(env);
  } catch (error) {
    return back(error instanceof ConfigError ? error.code : 'config_missing');
  }

  const url = new URL(request.url);
  const cookies = parseCookies(request.headers.get('cookie'));
  const stateHeaders = new Headers();
  stateHeaders.append('set-cookie', clearCookie(OAUTH_STATE_COOKIE, '/api/auth'));

  if (url.searchParams.get('error')) {
    // The user declined on GitHub's own consent screen.
    return redirect('/login?error=access_denied', stateHeaders);
  }

  const returnedState = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  if (!returnedState || !code) {
    return redirect('/login?error=bad_callback', stateHeaders);
  }

  const state = await readOauthState(config.sessionSecret, cookies[OAUTH_STATE_COOKIE]);
  if (!state || !(await timingSafeEqual(state.nonce, returnedState))) {
    return redirect('/login?error=state_mismatch', stateHeaders);
  }

  let profile;
  try {
    const userToken = await exchangeOauthCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      redirectUri: `${siteOrigin(request, env)}/api/auth/callback`,
    });
    profile = await fetchGitHubProfile(userToken);
  } catch (error) {
    const errorCode = error instanceof GitHubError ? error.code : 'oauth_failed';
    console.error('[auth/callback]', error instanceof Error ? error.message : error);
    return redirect(`/login?error=${encodeURIComponent(errorCode)}`, stateHeaders);
  }

  if (!isAdminLogin(profile.login, config.adminLogins)) {
    console.warn(`[auth/callback] rejected non-allowlisted login: ${profile.login}`);
    return redirect('/login?error=not_allowed', stateHeaders);
  }

  const { value } = await createSessionCookieValue(
    config.sessionSecret,
    { login: profile.login, id: profile.id, avatarUrl: profile.avatarUrl },
    config.sessionTtlSeconds,
  );

  stateHeaders.append(
    'set-cookie',
    serializeCookie(SESSION_COOKIE, value, {
      maxAge: config.sessionTtlSeconds,
      path: '/',
      sameSite: 'Lax',
      secure: cookieSecureFor(request),
    }),
  );

  return redirect(state.next, stateHeaders);
};
