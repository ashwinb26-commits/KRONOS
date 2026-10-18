/**
 * Server-side configuration.
 *
 * Every value here is a Cloudflare Pages environment variable or secret. None
 * of it is ever sent to the browser: the only thing the client learns is
 * whether publishing is configured at all, as a boolean.
 */

export interface Env {
  /** GitHub OAuth app client id. Public by nature, but kept server-side anyway. */
  GITHUB_OAUTH_CLIENT_ID?: string;
  /** GitHub OAuth app client secret. Secret. */
  GITHUB_OAUTH_CLIENT_SECRET?: string;
  /** At least 32 characters of random data. Signs session and OAuth state cookies. */
  SESSION_SECRET?: string;
  /** Comma separated list of GitHub logins allowed into the studio. */
  ADMIN_GITHUB_LOGINS?: string;

  /** Repository the data file lives in. */
  GITHUB_REPO_OWNER?: string;
  GITHUB_REPO_NAME?: string;
  /** Branch Cloudflare Pages builds from. Defaults to main. */
  GITHUB_REPO_BRANCH?: string;
  /** Path to the data file. Must sit under public/data/ and end in .json. */
  DATA_FILE_PATH?: string;

  /** Preferred write credential: a GitHub App installation. */
  GITHUB_APP_ID?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  /** PKCS#8 or PKCS#1 PEM private key for the GitHub App. Secret. */
  GITHUB_APP_PRIVATE_KEY?: string;

  /** Fallback write credential: a fine-grained personal access token. Secret. */
  GITHUB_DATA_TOKEN?: string;

  /**
   * Canonical site origin, for example https://dcf-valuation-lab.pages.dev.
   * Optional. When unset the origin is taken from the incoming request, which
   * is correct for Pages but means preview deployments sign in to themselves.
   */
  PUBLIC_SITE_ORIGIN?: string;

  /** Session lifetime in seconds. Defaults to 8 hours, capped at 24. */
  SESSION_TTL_SECONDS?: string;
}

export const DEFAULT_BRANCH = 'main';
export const DEFAULT_DATA_PATH = 'public/data/valuations.json';
export const DEFAULT_SESSION_TTL = 8 * 60 * 60;
const MAX_SESSION_TTL = 24 * 60 * 60;

/** Only data files, and only inside public/data. Never a workflow or source file. */
const DATA_PATH_PATTERN = /^public\/data\/[A-Za-z0-9._-]+\.json$/;

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  adminLogins: string[];
  sessionTtlSeconds: number;
}

export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
  dataPath: string;
}

export class ConfigError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ConfigError';
    this.code = code;
  }
}

function required(env: Env, key: keyof Env): string {
  const value = env[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(
      'config_missing',
      `Sign-in is not finished setting up on this deployment. The ${String(key)} value is missing.`,
    );
  }
  return value.trim();
}

export function parseAdminLogins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export function readAuthConfig(env: Env): AuthConfig {
  const sessionSecret = required(env, 'SESSION_SECRET');
  if (sessionSecret.length < 32) {
    throw new ConfigError(
      'config_weak_secret',
      'Sign-in is not finished setting up on this deployment. The session secret is too short.',
    );
  }
  const adminLogins = parseAdminLogins(env.ADMIN_GITHUB_LOGINS);
  if (adminLogins.length === 0) {
    throw new ConfigError(
      'config_no_admins',
      'Sign-in is not finished setting up on this deployment. No administrator account is configured.',
    );
  }

  const ttl = Number(env.SESSION_TTL_SECONDS ?? DEFAULT_SESSION_TTL);
  const sessionTtlSeconds =
    Number.isFinite(ttl) && ttl >= 300 ? Math.min(Math.floor(ttl), MAX_SESSION_TTL) : DEFAULT_SESSION_TTL;

  return {
    clientId: required(env, 'GITHUB_OAUTH_CLIENT_ID'),
    clientSecret: required(env, 'GITHUB_OAUTH_CLIENT_SECRET'),
    sessionSecret,
    adminLogins,
    sessionTtlSeconds,
  };
}

export function readRepoConfig(env: Env): RepoConfig {
  const dataPath = (env.DATA_FILE_PATH ?? DEFAULT_DATA_PATH).trim();
  if (!DATA_PATH_PATTERN.test(dataPath)) {
    throw new ConfigError(
      'config_data_path',
      'Publishing is not configured correctly on this deployment. The data file path must sit inside public/data and end in .json.',
    );
  }
  return {
    owner: required(env, 'GITHUB_REPO_OWNER'),
    repo: required(env, 'GITHUB_REPO_NAME'),
    branch: (env.GITHUB_REPO_BRANCH ?? DEFAULT_BRANCH).trim() || DEFAULT_BRANCH,
    dataPath,
  };
}

export type WriteCredential =
  | { kind: 'app'; appId: string; installationId: string; privateKeyPem: string }
  | { kind: 'token'; token: string };

/** The GitHub App installation is preferred, because its token expires on its own. */
export function readWriteCredential(env: Env): WriteCredential {
  if (env.GITHUB_APP_ID && env.GITHUB_APP_INSTALLATION_ID && env.GITHUB_APP_PRIVATE_KEY) {
    return {
      kind: 'app',
      appId: env.GITHUB_APP_ID.trim(),
      installationId: env.GITHUB_APP_INSTALLATION_ID.trim(),
      privateKeyPem: env.GITHUB_APP_PRIVATE_KEY,
    };
  }
  if (env.GITHUB_DATA_TOKEN && env.GITHUB_DATA_TOKEN.trim()) {
    return { kind: 'token', token: env.GITHUB_DATA_TOKEN.trim() };
  }
  throw new ConfigError(
    'config_no_write_credential',
    'Publishing is not configured on this deployment. Add a GitHub App installation or a fine-grained token with Contents write access.',
  );
}

/** True when a write credential exists, without revealing which or what it is. */
export function hasWriteCredential(env: Env): boolean {
  try {
    readWriteCredential(env);
    return true;
  } catch {
    return false;
  }
}

/** The origin the browser is talking to, used for redirect URIs and origin checks. */
export function siteOrigin(request: Request, env: Env): string {
  const configured = env.PUBLIC_SITE_ORIGIN?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return new URL(request.url).origin;
}
