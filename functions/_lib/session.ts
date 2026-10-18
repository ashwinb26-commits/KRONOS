/**
 * Stateless signed sessions and OAuth state, held in cookies.
 *
 * There is no session store, because Pages Functions have no guaranteed
 * storage binding and a signed cookie is enough for a one-administrator site.
 * The cookie holds who the user is and a CSRF token, nothing else. In
 * particular it never holds the GitHub user's access token: the site reads
 * the GitHub profile once at sign-in and then has no further use for it.
 */

import { randomToken, signHmac, timingSafeEqual, toBase64Url, fromBase64Url, verifyHmac } from './crypto';
import type { SessionUser } from '../../shared/types';

export const SESSION_COOKIE = 'dcf_session';
export const OAUTH_STATE_COOKIE = 'dcf_oauth_state';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface SessionPayload {
  v: 1;
  /** GitHub login. */
  sub: string;
  uid: number;
  av: string;
  iat: number;
  exp: number;
  /** Double-submit token. Returned to the client in a JSON body, never in a cookie. */
  csrf: string;
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

export interface CookieOptions {
  maxAge?: number;
  path?: string;
  sameSite?: 'Lax' | 'Strict' | 'None';
  secure?: boolean;
  httpOnly?: boolean;
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure !== false) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string, path = '/'): string {
  return serializeCookie(name, '', { maxAge: 0, path });
}

/**
 * Secure is dropped on plain-HTTP localhost only, so `wrangler pages dev` can
 * hold a session. Any other host, including a preview deployment, keeps it.
 */
export function cookieSecureFor(request: Request): boolean {
  const url = new URL(request.url);
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  return !(isLocal && url.protocol === 'http:');
}

export async function createSessionCookieValue(
  secret: string,
  user: { login: string; id: number; avatarUrl: string },
  ttlSeconds: number,
): Promise<{ value: string; payload: SessionPayload }> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    v: 1,
    sub: user.login,
    uid: user.id,
    av: user.avatarUrl,
    iat: now,
    exp: now + ttlSeconds,
    csrf: randomToken(32),
  };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await signHmac(secret, body);
  return { value: `${body}.${signature}`, payload };
}

/** Verify signature, version and expiry. Returns null on anything suspicious. */
export async function readSessionCookieValue(
  secret: string,
  value: string | undefined,
): Promise<SessionPayload | null> {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;
  const body = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (!(await verifyHmac(secret, body, signature))) return null;

  try {
    const payload = JSON.parse(decoder.decode(fromBase64Url(body))) as SessionPayload;
    if (payload.v !== 1) return null;
    if (typeof payload.sub !== 'string' || typeof payload.csrf !== 'string') return null;
    if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function toSessionUser(payload: SessionPayload): SessionUser {
  return {
    login: payload.sub,
    githubId: payload.uid,
    avatarUrl: payload.av,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

export function isAdminLogin(login: string, adminLogins: string[]): boolean {
  return adminLogins.includes(login.trim().toLowerCase());
}

/** Validate the CSRF header against the token bound to the session. */
export async function csrfOk(request: Request, payload: SessionPayload): Promise<boolean> {
  const header = request.headers.get('x-csrf-token');
  if (!header) return false;
  return timingSafeEqual(header, payload.csrf);
}

// --- OAuth state -----------------------------------------------------------

export interface OauthState {
  nonce: string;
  exp: number;
  /** Same-origin path to land on after sign-in. */
  next: string;
}

const STATE_TTL_SECONDS = 600;

/** Only same-origin absolute paths. Blocks open redirects and protocol tricks. */
export function safeNextPath(raw: string | null): string {
  if (!raw) return '/admin';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/admin';
  if (/[\u0000-\u001F\\]/.test(raw)) return '/admin';
  return raw.slice(0, 200);
}

export async function createOauthState(
  secret: string,
  next: string,
): Promise<{ nonce: string; cookieValue: string }> {
  const state: OauthState = {
    nonce: randomToken(24),
    exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
    next: safeNextPath(next),
  };
  const body = toBase64Url(encoder.encode(JSON.stringify(state)));
  const signature = await signHmac(secret, body);
  return { nonce: state.nonce, cookieValue: `${body}.${signature}` };
}

export async function readOauthState(
  secret: string,
  cookieValue: string | undefined,
): Promise<OauthState | null> {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf('.');
  if (dot < 1) return null;
  const body = cookieValue.slice(0, dot);
  const signature = cookieValue.slice(dot + 1);
  if (!(await verifyHmac(secret, body, signature))) return null;
  try {
    const state = JSON.parse(decoder.decode(fromBase64Url(body))) as OauthState;
    if (typeof state.nonce !== 'string' || typeof state.exp !== 'number') return null;
    if (state.exp <= Math.floor(Date.now() / 1000)) return null;
    return { ...state, next: safeNextPath(state.next) };
  } catch {
    return null;
  }
}
