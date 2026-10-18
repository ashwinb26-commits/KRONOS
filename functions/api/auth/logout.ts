/**
 * Ends the session.
 *
 * POST only, with the CSRF token and a same-origin check, so a third-party
 * page cannot sign the analyst out mid-edit.
 */

import { readAuthConfig, siteOrigin, type Env } from '../../_lib/env';
import { apiError, json, originRejection } from '../../_lib/responses';
import {
  SESSION_COOKIE,
  clearCookie,
  csrfOk,
  parseCookies,
  readSessionCookieValue,
} from '../../_lib/session';

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return apiError(405, 'method_not_allowed', 'Sign out with a POST request.');
  }

  const rejection = originRejection(request, siteOrigin(request, env));
  if (rejection) return rejection;

  let config;
  try {
    config = readAuthConfig(env);
  } catch {
    return json({ ok: true }, { headers: { 'set-cookie': clearCookie(SESSION_COOKIE) } });
  }

  const cookies = parseCookies(request.headers.get('cookie'));
  const payload = await readSessionCookieValue(config.sessionSecret, cookies[SESSION_COOKIE]);

  if (payload && !(await csrfOk(request, payload))) {
    return apiError(403, 'csrf', 'That sign-out request could not be verified. Reload the page and try again.');
  }

  return json({ ok: true }, { headers: { 'set-cookie': clearCookie(SESSION_COOKIE) } });
};
