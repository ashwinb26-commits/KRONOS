/**
 * Build-time deployment settings.
 *
 * The same code ships to two kinds of host:
 *
 *  - Cloudflare Pages, with Functions: GitHub sign-in, an allowlist, and a
 *    publish button that commits to the repository from the server.
 *  - GitHub Pages, static only: no server, so no sign-in and no secrets. The
 *    studio runs the same validation and recalculation in the browser and
 *    hands over the updated data file, which the analyst uploads to the
 *    repository. Only someone with write access to the repository can do
 *    that, so GitHub's own permissions are the access control.
 *
 * The GitHub Pages workflow sets the variables below. A plain build leaves
 * them unset and produces the Cloudflare version.
 */

export const STATIC_MODE = import.meta.env.VITE_STATIC_MODE === '1';

/** Base path without a trailing slash: '' at a domain root, '/KRONOS' under a project URL. */
export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/+$/, '');

const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const rawRepository = import.meta.env.VITE_REPOSITORY ?? '';

/** owner/repo of the repository the static site was built from, if known. */
export const STATIC_REPOSITORY: string | null = repoPattern.test(rawRepository) ? rawRepository : null;
export const STATIC_BRANCH: string = /^[A-Za-z0-9_./-]+$/.test(import.meta.env.VITE_BRANCH ?? '')
  ? (import.meta.env.VITE_BRANCH as string)
  : 'main';

/** Where the data file sits inside the repository. Fixed by the project layout. */
export const DATA_FILE_PATH = 'public/data/valuations.json';

/** Turn an in-app path such as '/admin' into the real URL path for this host. */
export function withBase(path: string): string {
  return `${BASE_PATH}${path.startsWith('/') ? path : `/${path}`}`;
}

/** The inverse of withBase. Anything outside the base path maps to '/'. */
export function stripBase(pathname: string): string {
  if (!BASE_PATH) return pathname || '/';
  if (pathname === BASE_PATH) return '/';
  if (pathname.startsWith(`${BASE_PATH}/`)) return pathname.slice(BASE_PATH.length) || '/';
  return '/';
}
