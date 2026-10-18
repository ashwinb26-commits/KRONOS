/**
 * Moved to shared/types.ts.
 *
 * The types are now imported by the Cloudflare Functions as well as the
 * browser bundle, so they live outside src/ where both can reach them. This
 * file stays as a re-export so the original import path still resolves.
 */

export * from '../shared/types';
