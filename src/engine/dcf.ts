/**
 * Moved to shared/dcf.ts.
 *
 * The free cash flow logic from the starter is intact there, extended with a
 * cost of capital build-up, year by year drivers and an explicit equity
 * bridge. It lives outside src/ because the publish endpoint recalculates the
 * model on the server, and the server and the browser have to run the same
 * code or they will disagree about what a number means.
 *
 * This file stays as a re-export so the original import path still resolves.
 */

export * from '../../shared/dcf';
