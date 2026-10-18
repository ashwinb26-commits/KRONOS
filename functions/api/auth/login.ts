/**
 * Starts the GitHub OAuth flow.
 *
 * A signed, short-lived state cookie is set before the redirect. The state
 * value sent to GitHub is the nonce inside that cookie, which is what makes a
 * forged callback fail: an attacker can send a user to our callback URL, but
 * cannot produce a matching signed cookie.
 *
 * No scope is requested. The public profile is all this site needs, and asking
 * for nothing means a stolen user token grants nothing either.
 */

import { ConfigError, readAuthConfig, siteOrigin, type Env } from '../../_lib/env';
import { redirect } from '../../_lib/responses';
import {
  OAUTH_STATE_COOKIE,
  cookieSecureFor,
  createOauthState,
  safeNextPath,
  serializeCookie,
} from '../../_lib/session';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  let config;
  try {
    config = readAuthConfig(env);
  } catch (error) {
    const code = error instanceof ConfigError ? error.code : 'config_missing';
    return redirect(`/login?error=${encodeURIComponent(code)}`);
  }

  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get('next'));
  const origin = siteOrigin(request, env);
  const { nonce, cookieValue } = await createOauthState(config.sessionSecret, next);

  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', config.clientId);
  authorize.searchParams.set('redirect_uri', `${origin}/api/auth/callback`);
  authorize.searchParams.set('state', nonce);
  authorize.searchParams.set('scope', '');
  authorize.searchParams.set('allow_signup', 'false');

  const headers = new Headers();
  headers.append(
    'set-cookie',
    serializeCookie(OAUTH_STATE_COOKIE, cookieValue, {
      maxAge: 600,
      path: '/api/auth',
      sameSite: 'Lax',
      secure: cookieSecureFor(request),
    }),
  );

  return redirect(authorize.toString(), headers);
};
