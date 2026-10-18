# Security guide

What this site protects, how, what it does not protect, and how to rotate every
credential it uses.

## The threat model, stated plainly

This is a public website with one administrator. Everything on the public side
is meant to be public: the financial figures, the assumptions, the formulas and
the JavaScript that runs them. None of that is worth hiding, and pretending
otherwise would be theatre.

What is worth protecting is the ability to change what the site says, and the
credential that lets the site write to a GitHub repository.

So the whole design reduces to 2 questions:

1. Can anybody other than the administrator change the published data?
2. Can the GitHub write credential leak?

## How the first question is answered

Every write endpoint checks 4 things, on the server, on every request, in this
order. Failing any of them ends the request before the handler sees it.

| Check | What it stops |
| --- | --- |
| Same origin, by `Sec-Fetch-Site` or `Origin` | A page on another domain making the request with your cookie |
| A valid, unexpired, HMAC-signed session cookie | A forged or tampered session |
| The login is still on the server-side allowlist | An account whose access was revoked after the cookie was issued |
| The CSRF token in `X-CSRF-Token` matches the one bound to the session | A cross-site request that somehow passed the origin check |

The route protection in the browser is not on that list, because it is not a
control. Typing `/admin` into the address bar loads the editor shell, and the
editor then has no data to show and no way to publish, because `/api/data` and
`/api/publish` refuse it.

Beyond the gate:

- **Server-side validation.** The payload is re-validated with the same rules
  the studio ran. The schema is closed, so an unexpected key is rejected rather
  than stored. Numbers are range checked, dates and financial-year labels are
  pattern checked, and the body is size capped before it is parsed.
- **Server-side recalculation.** Every output is recomputed from the submitted
  inputs. Results sent by the browser are discarded. A tampered client cannot
  publish figures that do not follow from the assumptions printed beside them.
- **A narrow write.** The Contents API can only touch the path it is given. The
  configured path must match `public/data/*.json`, so no value of
  `DATA_FILE_PATH` can reach a workflow file, a source file or anything outside
  that folder.
- **No silent overwrites.** The write carries the blob SHA the server itself
  just read. An update prepared against an older version is refused. Publishing
  appends a new snapshot and never edits or removes an existing one.

## How the second question is answered

The GitHub write credential lives only in Cloudflare's secret storage and is
only ever read inside a Function. It is never sent to the browser, never put in
a response body, and never written into the data file.

The session cookie deliberately does not contain a GitHub access token. The
user token obtained during sign-in is used once, to read the login and numeric
ID, and then discarded. There is nothing in the cookie worth stealing beyond
the session itself.

Nothing is stored in `localStorage` or `sessionStorage` except an in-progress
snapshot draft, which is public financial data on its way to a public JSON file.
The CSRF token is returned in a JSON response body and held in React state for
the life of the tab, so it never touches storage either.

Cookies are `HttpOnly`, `Secure` and `SameSite=Lax`. `Secure` is dropped on one
case and one only: plain-HTTP `localhost`, so local development can hold a
session. Any other host, preview deployments included, keeps it.

## Sign-in

GitHub OAuth, with:

- **No scopes requested.** The public profile is all this site needs. A stolen
  user token grants nothing.
- **State validation.** A signed, 10 minute state cookie is set before the
  redirect and compared, in constant time, against what GitHub returns. A
  forged callback fails because the attacker cannot produce the matching
  signed cookie.
- **Allowlist before session.** A login that is not on the list leaves with no
  cookie at all, and the rejection is logged.
- **Same-origin destination only.** The post sign-in destination has to be an
  absolute same-origin path, which closes the open redirect.
- **Errors as codes.** Failures redirect with a short code that the sign-in page
  turns into a sentence. No upstream error body, no client secret, nothing from
  GitHub's response is ever rendered.

## Response headers

`functions/_middleware.ts` sets these on every response, static assets included:

```
content-security-policy: default-src 'self'; base-uri 'self'; form-action 'self';
  frame-ancestors 'none'; object-src 'none'; script-src 'self';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: https://avatars.githubusercontent.com;
  connect-src 'self'; upgrade-insecure-requests
x-content-type-options: nosniff
x-frame-options: DENY
referrer-policy: strict-origin-when-cross-origin
permissions-policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(),
  magnetometer=(), microphone=(), payment=(), usb=()
cross-origin-opener-policy: same-origin
strict-transport-security: max-age=31536000; includeSubDomains
```

Everything under `/api/` also gets `cache-control: no-store`.

`style-src` allows `unsafe-inline` because React writes a handful of inline
style attributes for chart geometry. That is a real, if small, weakening: it
means an attacker who could already inject markup could also inject styles.
Removing it would mean moving every computed style into classes, which is
possible and is the obvious next hardening step if this ever holds anything
sensitive.

## Text handling

Research notes and source labels are free text. They are stored with control
characters removed and a length cap applied, and they are rendered as React
text nodes, which escape on output. They are never passed to `dangerouslySet
InnerHTML`, never inserted as markup, and never evaluated. The combination of
output escaping and a content security policy with no inline script is what
makes stored script injection a non-event here.

## What this does not protect against

Stated honestly, because a security document that only lists strengths is not
worth reading.

- **A compromised GitHub account.** Anybody who can sign in as an allowlisted
  login can publish. Turn on 2 factor authentication. That is the single
  highest-value thing you can do for this site.
- **A compromised Cloudflare account.** Whoever controls the dashboard controls
  the secrets.
- **Rate limiting.** There is none in the application. A Worker isolate has no
  shared counter to rate limit against, and a per-isolate counter would be
  security theatre. If the publish endpoint ever gets hammered, the right tool
  is a Cloudflare WAF rate-limiting rule on `/api/*`, configured in the
  dashboard. The allowlist already means an unauthenticated flood cannot write
  anything, only consume invocations.
- **Audit logging beyond git.** The commit history records who published what
  and when. Failed sign-ins are logged to the Cloudflare function log, which
  has a short retention. For one analyst this is enough. For a team it is not.
- **Supply chain.** The dependency tree is small (React, Vite, TypeScript,
  Vitest, Wrangler) but it exists. Run `npm audit` periodically and keep
  Dependabot on.
- **The content of the research.** Nothing here can tell you whether a beta of
  0.73 is defensible. The validator checks that figures reconcile, not that
  they are true.

## Rotating credentials

Rotate all of these if you ever suspect exposure, and rotate the token on a
schedule regardless.

### The session secret

Rotating it signs everybody out immediately, which is the point.

```bash
openssl rand -base64 48
```

Update `SESSION_SECRET` in Cloudflare, then redeploy. Every existing session
cookie fails its signature check on the next request and the holder is sent to
sign in again.

### The OAuth client secret

1. In the OAuth app settings, generate a new client secret.
2. Update `GITHUB_OAUTH_CLIENT_SECRET` in Cloudflare and redeploy.
3. Delete the old secret in GitHub.

Do it in that order. Deleting first breaks sign-in until the redeploy lands.

### The GitHub App private key

1. In the App settings, generate a new private key.
2. Convert it:
   `openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in new.pem -out new-pkcs8.pem`
3. Update `GITHUB_APP_PRIVATE_KEY` in Cloudflare and redeploy.
4. Delete the old key in GitHub.
5. Publish something small to confirm it works.

### The fine-grained token

1. Generate a replacement with the same single-repository Contents read and
   write scope.
2. Update `GITHUB_DATA_TOKEN` in Cloudflare and redeploy.
3. Revoke the old token.

If you are still on a token, moving to a GitHub App is worth the 5 minutes. An
installation token is minted per request and expires in an hour, so there is no
long-lived secret to rotate at all.

### Removing an administrator

Take the login out of `ADMIN_GITHUB_LOGINS` and redeploy. The allowlist is
re-checked on every request, so the removal takes effect on that person's next
request rather than whenever their cookie happens to expire.

## A short checklist, every 6 months

Pair this with the research cycle, since you are in here anyway.

- [ ] 2 factor authentication is on for the GitHub account
- [ ] `ADMIN_GITHUB_LOGINS` lists only people who should still have access
- [ ] The write credential is a GitHub App, or the token is not near expiry
- [ ] The App or token still has Contents access to this repository and nothing
      else
- [ ] `npm audit` is clean, or the findings are understood
- [ ] No secret has been committed: `git log -p -- .dev.vars` returns nothing
- [ ] The deployed site still sends the headers above, checked in the browser's
      network panel
