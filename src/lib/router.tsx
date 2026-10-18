/**
 * A history router in about 60 lines.
 *
 * The app has four routes and no need for a routing library. Links go through
 * `navigate` so the browser back button, refresh and shareable URLs all work,
 * which matters for the studio: a long edit session deserves a real URL per
 * section rather than hidden tab state.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

interface RouteValue {
  path: string;
  search: string;
  query: URLSearchParams;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouteContext = createContext<RouteValue | null>(null);

function readLocation() {
  return { path: window.location.pathname, search: window.location.search };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(readLocation);

  useEffect(() => {
    const onPopState = () => setLocation(readLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    const target = new URL(to, window.location.origin);
    if (target.origin !== window.location.origin) {
      window.location.assign(to);
      return;
    }
    if (options?.replace) window.history.replaceState(null, '', target);
    else window.history.pushState(null, '', target);
    setLocation({ path: target.pathname, search: target.search });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const value = useMemo<RouteValue>(
    () => ({
      path: location.path,
      search: location.search,
      query: new URLSearchParams(location.search),
      navigate,
    }),
    [location.path, location.search, navigate],
  );

  return <RouteContext.Provider value={value}>{children}</RouteContext.Provider>;
}

export function useRoute(): RouteValue {
  const value = useContext(RouteContext);
  if (!value) throw new Error('useRoute must be used inside RouterProvider.');
  return value;
}

/**
 * An anchor that keeps normal link behaviour, so middle-click and
 * open-in-new-tab still work, but routes in-app on a plain left click.
 */
export function Link({
  to,
  children,
  ...rest
}: { to: string; children: ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const { navigate } = useRoute();
  return (
    <a
      href={to}
      onClick={(event) => {
        if (event.defaultPrevented) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
