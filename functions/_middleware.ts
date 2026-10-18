/**
 * Runs in front of every request, including static assets, so the security
 * headers apply to the whole site rather than only the API.
 *
 * The content security policy is deliberately tight: scripts may only come
 * from this origin, there are no inline scripts in the build, and the page
 * cannot be framed. Inline styles are allowed because React writes a few style
 * attributes for chart geometry.
 */

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://avatars.githubusercontent.com",
  "connect-src 'self'",
  'upgrade-insecure-requests',
].join('; ');

export const onRequest: PagesFunction = async (context) => {
  const response = await context.next();
  const headers = new Headers(response.headers);

  headers.set('content-security-policy', CSP);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set(
    'permissions-policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
  );
  headers.set('cross-origin-opener-policy', 'same-origin');
  headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');

  // Nothing under /api may be cached by a browser or an intermediary.
  if (new URL(context.request.url).pathname.startsWith('/api/')) {
    headers.set('cache-control', 'no-store');
  }

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
