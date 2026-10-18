/**
 * Application shell and routing.
 *
 * Three views: the public dashboard at /, sign-in at /login, and the studio at
 * /admin and its sub-routes. The session is fetched once here and handed down,
 * so the chrome knows whether to show a sign-in link or the signed-in account.
 *
 * Route protection in this file is a convenience, not a control. Every write
 * endpoint checks the session, the allowlist and the CSRF token again on the
 * server, so navigating to /admin by hand gets an editor with no data in it
 * and no way to publish.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError, getSession, signOut } from './lib/api';
import { Link, RouterProvider, useRoute } from './lib/router';
import type { SessionResponse } from '../shared/types';
import { PublicDashboard } from './views/PublicDashboard';
import { LoginView } from './views/LoginView';
import { AdminStudio } from './views/AdminStudio';
import { Button } from './components/ui';

export default function App() {
  return (
    <RouterProvider>
      <Routes />
    </RouterProvider>
  );
}

function Routes() {
  const { path } = useRoute();
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  const refreshSession = useCallback(async () => {
    try {
      setSession(await getSession());
    } catch (error) {
      // A deployment without Functions, for example a static host, has no
      // session endpoint. The public dashboard still works, so this is not an
      // error worth showing anybody.
      if (!(error instanceof ApiError)) console.warn('Session check failed.', error);
      setSession({ authenticated: false, user: null, csrfToken: null, publishConfigured: false });
    } finally {
      setSessionLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  if (path === '/login') {
    return <LoginView session={session} />;
  }

  const isAdmin = path === '/admin' || path.startsWith('/admin/');

  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to the main content</a>
      <Chrome session={session} onSignedOut={refreshSession} isAdmin={isAdmin} />
      {isAdmin ? (
        <AdminStudio session={session} sessionLoaded={sessionLoaded} onSessionChange={refreshSession} />
      ) : (
        <PublicDashboard />
      )}
      <SiteFooter />
    </div>
  );
}

function Chrome({
  session,
  onSignedOut,
  isAdmin,
}: {
  session: SessionResponse | null;
  onSignedOut: () => void;
  isAdmin: boolean;
}) {
  const { path, navigate } = useRoute();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <header className="chrome">
      <div className="chrome-inner">
        <Link to="/" className="brand" aria-label="DCF Valuation Lab, go to the dashboard">
          <span className="brand-mark" aria-hidden="true">DCF</span>
          <span>Valuation Lab</span>
        </Link>

        <nav className="chrome-nav" aria-label="Main">
          <Link to="/" aria-current={path === '/' ? 'page' : undefined}>Dashboard</Link>
          {session?.authenticated ? (
            <Link to="/admin" aria-current={isAdmin ? 'page' : undefined}>Studio</Link>
          ) : null}
        </nav>

        <span className="chrome-spacer" />

        <div className="chrome-actions">
          {session?.authenticated && session.user ? (
            <>
              <span className="text-meta">{session.user.login}</span>
              <Button
                variant="secondary"
                busy={signingOut}
                busyLabel="Signing out"
                onClick={async () => {
                  if (!session.csrfToken) return;
                  setSigningOut(true);
                  try {
                    await signOut(session.csrfToken);
                    onSignedOut();
                    navigate('/');
                  } finally {
                    setSigningOut(false);
                  }
                }}
              >
                Sign out
              </Button>
            </>
          ) : (
            <Link to="/login" className="btn btn-secondary">Sign in</Link>
          )}
        </div>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <span>
          An independent research project. Nothing here is investment advice or a recommendation to buy or sell
          anything.
        </span>
        <a href="#main">Back to the top</a>
      </div>
    </footer>
  );
}
