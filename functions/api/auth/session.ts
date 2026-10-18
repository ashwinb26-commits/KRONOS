/**
 * Who is signed in, and the CSRF token for this session.
 *
 * The token is returned in the response body rather than a readable cookie, so
 * it lives in the studio's memory for the life of the tab and is never written
 * to local storage. The allowlist is re-checked on every call, so removing a
 * login from the configuration logs that person out on their next request
 * rather than when their cookie happens to expire.
 */

import { hasWriteCredential, readAuthConfig, type Env } from '../../_lib/env';
import { json } from '../../_lib/responses';
import {
  SESSION_COOKIE,
  clearCookie,
  isAdminLogin,
  parseCookies,
  readSessionCookieValue,
  toSessionUser,
} from '../../_lib/session';
import type { SessionResponse } from '../../../shared/types';

const anonymous = (publishConfigured: boolean): SessionResponse => ({
  authenticated: false,
  user: null,
  csrfToken: null,
  publishConfigured,
});

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const publishConfigured = hasWriteCredential(env);

  let config;
  try {
    config = readAuthConfig(env);
  } catch {
    return json(anonymous(publishConfigured));
  }

  const cookies = parseCookies(request.headers.get('cookie'));
  const payload = await readSessionCookieValue(config.sessionSecret, cookies[SESSION_COOKIE]);

  if (!payload) {
    return json(anonymous(publishConfigured));
  }

  if (!isAdminLogin(payload.sub, config.adminLogins)) {
    return json(anonymous(publishConfigured), {
      headers: { 'set-cookie': clearCookie(SESSION_COOKIE) },
    });
  }

  const body: SessionResponse = {
    authenticated: true,
    user: toSessionUser(payload),
    csrfToken: payload.csrf,
    publishConfigured,
  };
  return json(body);
};
