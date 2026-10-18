/**
 * The gate every write endpoint goes through.
 *
 * Route protection in the browser is a convenience for the analyst, not a
 * control. This runs on the server for each request, in this order: same
 * origin, valid signed session, login still on the allowlist, matching CSRF
 * token. Anything short of all four is refused before the handler sees it.
 */

import { readAuthConfig, siteOrigin, ConfigError, type AuthConfig, type Env } from './env';
import { apiError, originRejection } from './responses';
import {
  SESSION_COOKIE,
  csrfOk,
  isAdminLogin,
  parseCookies,
  readSessionCookieValue,
  type SessionPayload,
} from './session';

export type GuardResult =
  | { ok: true; session: SessionPayload; config: AuthConfig; origin: string }
  | { ok: false; response: Response };

export async function requireAdmin(
  request: Request,
  env: Env,
  options: { requireCsrf: boolean },
): Promise<GuardResult> {
  const origin = siteOrigin(request, env);

  if (options.requireCsrf) {
    const rejection = originRejection(request, origin);
    if (rejection) return { ok: false, response: rejection };
  }

  let config: AuthConfig;
  try {
    config = readAuthConfig(env);
  } catch (error) {
    return {
      ok: false,
      response: apiError(
        503,
        error instanceof ConfigError ? error.code : 'config_missing',
        error instanceof ConfigError
          ? error.message
          : 'Sign-in is not finished setting up on this deployment.',
      ),
    };
  }

  const cookies = parseCookies(request.headers.get('cookie'));
  const session = await readSessionCookieValue(config.sessionSecret, cookies[SESSION_COOKIE]);

  if (!session) {
    return {
      ok: false,
      response: apiError(401, 'not_signed_in', 'That session has ended. Sign in again to continue.'),
    };
  }

  // Re-checked on every request, so revoking access in the configuration takes
  // effect immediately rather than when the cookie expires.
  if (!isAdminLogin(session.sub, config.adminLogins)) {
    return {
      ok: false,
      response: apiError(
        403,
        'not_allowed',
        'This GitHub account does not have studio access on this deployment.',
      ),
    };
  }

  if (options.requireCsrf && !(await csrfOk(request, session))) {
    return {
      ok: false,
      response: apiError(
        403,
        'csrf',
        'That request could not be verified. Reload the studio and try again.',
      ),
    };
  }

  return { ok: true, session, config, origin };
}
