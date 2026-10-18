/**
 * Browser side of the API.
 *
 * The CSRF token lives in React state for the life of the tab, handed over by
 * /api/auth/session. It is deliberately never written to localStorage or
 * sessionStorage, and there is no access token here to store in the first
 * place: the session cookie is HttpOnly, so this code cannot read it.
 */

import type {
  ApiErrorResponse,
  PublishResponse,
  SessionResponse,
  ValidationIssue,
  ValuationFile,
  ValuationSnapshot,
} from '../../shared/types';
import { isValuationFile } from '../../shared/validation';
import { DATA_FILE_PATH, STATIC_BRANCH, STATIC_REPOSITORY, withBase } from './config';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly issues: ValidationIssue[];
  readonly ref?: string;

  constructor(status: number, body: Partial<ApiErrorResponse>) {
    super(body.message ?? 'The request could not be completed. Try again.');
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code ?? 'unknown';
    this.issues = body.issues ?? [];
    this.ref = body.ref;
  }
}

/** Details the analyst can copy into a bug report, with no response body in it. */
export function errorDetails(error: unknown, route: string): string {
  if (error instanceof ApiError) {
    return JSON.stringify(
      { code: error.code, status: error.status, ref: error.ref ?? null, route, at: new Date().toISOString() },
      null,
      2,
    );
  }
  return JSON.stringify(
    { code: 'network', message: error instanceof Error ? error.message : String(error), route, at: new Date().toISOString() },
    null,
    2,
  );
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: { accept: 'application/json', ...(init.headers as Record<string, string> | undefined) },
  });

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, (body ?? {}) as Partial<ApiErrorResponse>);
  }
  return body as T;
}

export function getSession(): Promise<SessionResponse> {
  return request<SessionResponse>('/api/auth/session');
}

export function signOut(csrfToken: string): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/auth/logout', {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken },
  });
}

export interface LiveDataResponse {
  ok: true;
  sha: string | null;
  path: string;
  branch: string;
  repository: string;
  file: ValuationFile | null;
}

/** The repository's current data file, for the studio. Admin only. */
export function getLiveData(): Promise<LiveDataResponse> {
  return request<LiveDataResponse>('/api/data');
}

export function publishSnapshot(input: {
  snapshot: ValuationSnapshot;
  baseFileSha: string | null;
  acknowledgeWarnings: boolean;
  csrfToken: string;
}): Promise<PublishResponse> {
  const { csrfToken, ...body } = input;
  return request<PublishResponse>('/api/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(body),
  });
}

/**
 * The published data file as deployed with the site. Readable without signing
 * in. `no-cache` revalidates rather than skipping the cache, so a redeploy is
 * picked up immediately while an unchanged file still comes back as a 304.
 */
export async function loadPublishedData(): Promise<ValuationFile> {
  const response = await fetch(withBase('/data/valuations.json'), {
    headers: { accept: 'application/json' },
    cache: 'no-cache',
  });
  if (!response.ok) {
    throw new ApiError(response.status, {
      code: 'data_unavailable',
      message: 'The published valuation data could not be loaded. Reload the page to try again.',
    });
  }
  return (await response.json()) as ValuationFile;
}

export interface RepositoryCopy {
  file: ValuationFile;
  /** The exact text, so a merge works from precisely what was read. */
  text: string;
  /** Where it came from: the repository itself, or the copy deployed with the site. */
  source: 'repository' | 'deployed';
}

/**
 * GitHub Pages only: the data file as it stands in the repository right now.
 *
 * The deployed copy can lag the repository by the minute or two a rebuild
 * takes. If an analyst uploaded a new file and then opened the studio again
 * before the rebuild finished, working from the deployed copy would silently
 * drop that upload from the next file. So the studio reads the repository
 * first, through GitHub's raw file host, and falls back to the deployed copy
 * only when that cannot be reached (a private repository, or no network).
 */
export async function loadRepositoryCopy(): Promise<RepositoryCopy> {
  if (STATIC_REPOSITORY) {
    try {
      const url = `https://raw.githubusercontent.com/${STATIC_REPOSITORY}/${encodeURIComponent(STATIC_BRANCH)}/${DATA_FILE_PATH}?t=${Date.now()}`;
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) {
        const text = await response.text();
        const parsed: unknown = JSON.parse(text);
        if (isValuationFile(parsed)) return { file: parsed, text, source: 'repository' };
      }
    } catch {
      /* Fall through to the deployed copy. */
    }
  }

  const response = await fetch(withBase('/data/valuations.json'), { cache: 'no-cache' });
  if (!response.ok) {
    throw new ApiError(response.status, {
      code: 'data_unavailable',
      message: 'The published valuation data could not be loaded. Reload the page to try again.',
    });
  }
  const text = await response.text();
  const parsed: unknown = JSON.parse(text);
  if (!isValuationFile(parsed)) {
    throw new ApiError(500, {
      code: 'corrupt_data',
      message: 'The deployed data file does not match the snapshot format. Replace it with a file the studio produced.',
    });
  }
  return { file: parsed, text, source: 'deployed' };
}
