/**
 * Response helpers.
 *
 * One rule runs through all of it: an error that reaches the browser carries a
 * stable code, a sentence the interface can show, and nothing else. Secrets,
 * stack traces and upstream response bodies stay on the server.
 */

import type { ApiErrorResponse, ValidationIssue } from '../../shared/types';

const BASE_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
};

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...BASE_HEADERS, ...(init.headers as Record<string, string> | undefined) },
  });
}

/** Short reference the analyst can quote when reading the deployment logs. */
export function errorRef(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function apiError(
  status: number,
  code: string,
  message: string,
  extra: { issues?: ValidationIssue[]; ref?: string } = {},
): Response {
  const body: ApiErrorResponse = { ok: false, code, message, ...extra };
  return json(body, { status });
}

/**
 * Log an unexpected failure with a reference, then return a generic error.
 * The caught value is logged but never returned, because upstream errors can
 * echo request headers back.
 */
export function unexpected(scope: string, error: unknown): Response {
  const ref = errorRef();
  console.error(`[${scope}] ref=${ref}`, error instanceof Error ? error.message : error);
  return apiError(
    500,
    'unexpected',
    'Something went wrong on the server. Try again, and quote the reference below if it keeps failing.',
    { ref },
  );
}

/**
 * Reject a state-changing request that did not come from this site.
 *
 * Checks Sec-Fetch-Site where the browser sends it, and falls back to Origin.
 * A request with neither is rejected rather than trusted.
 */
export function originRejection(request: Request, expectedOrigin: string): Response | null {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'same-origin') return null;
  if (fetchSite && fetchSite !== 'same-origin') {
    return apiError(403, 'cross_origin', 'This request did not come from the studio. Reload the page and try again.');
  }

  const origin = request.headers.get('origin');
  if (origin && origin === expectedOrigin) return null;

  return apiError(
    403,
    'cross_origin',
    'This request did not come from the studio. Reload the page and try again.',
  );
}

export function redirect(location: string, headers: Headers = new Headers()): Response {
  headers.set('location', location);
  headers.set('cache-control', 'no-store');
  return new Response(null, { status: 302, headers });
}
