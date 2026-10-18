/**
 * Sign-in.
 *
 * Page pattern: Form (auth). A centred card with no app chrome.
 *
 * There is no password field, and no credential of any kind is handled in the
 * browser. The button is a plain link to a server endpoint which starts the
 * GitHub OAuth flow; the allowlist check and the session are both decided on
 * the server, so there is nothing here worth tampering with.
 */

import { useEffect } from 'react';
import { Banner, Button } from '../components/ui';
import { Link, useRoute } from '../lib/router';
import type { SessionResponse } from '../../shared/types';

/**
 * Failures arrive as a code on the query string. They are mapped here, so the
 * server never has to put a sentence in a redirect and nothing from GitHub's
 * response body is ever echoed into the page.
 */
const ERROR_COPY: Record<string, { title: string; body: string }> = {
  config_missing: {
    title: 'Sign-in is not set up on this deployment yet',
    body: 'The GitHub OAuth app and session secret have not been added to the Cloudflare environment. The setup guide in docs/setup-guide.md covers it.',
  },
  config_weak_secret: {
    title: 'Sign-in is not set up on this deployment yet',
    body: 'The session secret is too short to sign a session with. Generate at least 32 random characters and set it again.',
  },
  config_no_admins: {
    title: 'Sign-in is not set up on this deployment yet',
    body: 'No GitHub login has been added to the administrator list, so nobody can be let in. Set ADMIN_GITHUB_LOGINS and redeploy.',
  },
  access_denied: {
    title: 'Sign-in was cancelled',
    body: 'The GitHub consent screen was closed before it finished. Start again below whenever you are ready.',
  },
  bad_callback: {
    title: 'That sign-in link was incomplete',
    body: 'Some of what GitHub sent back was missing. Start again below.',
  },
  state_mismatch: {
    title: 'That sign-in attempt has expired',
    body: 'Sign-in attempts last 10 minutes and have to finish in the browser that started them. Start again below.',
  },
  not_allowed: {
    title: 'That GitHub account does not have studio access',
    body: 'Only the logins on this deployment’s administrator list can open the studio. The public dashboard is open to everyone.',
  },
  oauth_exchange: {
    title: 'That sign-in link has already been used',
    body: 'GitHub sign-in links work once. Start again below.',
  },
  oauth_profile: {
    title: 'GitHub could not confirm the account',
    body: 'The profile lookup did not come back. Try again in a moment.',
  },
  oauth_failed: {
    title: 'Sign-in could not be completed',
    body: 'Something went wrong talking to GitHub. Try again in a moment.',
  },
  session_expired: {
    title: 'That session has ended',
    body: 'Sessions last 8 hours. Sign in again to carry on where you left off, since drafts are kept in this browser.',
  },
};

export function LoginView({ session }: { session: SessionResponse | null }) {
  const { query, navigate } = useRoute();
  const errorCode = query.get('error');
  const next = query.get('next') ?? '/admin';
  const error = errorCode ? (ERROR_COPY[errorCode] ?? ERROR_COPY.oauth_failed) : null;

  // Already signed in: go straight through rather than showing a dead button.
  useEffect(() => {
    if (session?.authenticated) navigate(next, { replace: true });
  }, [session, next, navigate]);

  return (
    <div className="auth">
      <div className="auth-card stack-6">
        <div>
          <h1>Sign in to the studio</h1>
          <p className="text-secondary">
            The research studio is where the financial data and the valuation assumptions are edited and published.
          </p>
        </div>

        {error ? (
          <Banner tone={errorCode === 'not_allowed' ? 'error' : 'warn'} title={error.title}>
            {error.body}
          </Banner>
        ) : null}

        <div className="stack-3">
          {/* A plain link, so the browser does a top-level navigation and the
              OAuth state cookie is set before leaving. */}
          <a className="btn btn-primary" href={`/api/auth/login?next=${encodeURIComponent(next)}`}>
            Sign in with GitHub
          </a>
          <p className="text-meta">
            Authentication runs on the server against a fixed list of GitHub logins. No password is stored or handled by
            this site, and no access token is kept after sign-in.
          </p>
        </div>

        <div className="auth-foot stack-3">
          <p>
            Nothing on the public dashboard needs an account. Signing in only adds the ability to edit and publish.
          </p>
          <Link to="/">
            <Button variant="quiet">Go back to the dashboard</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
