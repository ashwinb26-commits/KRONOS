/**
 * Checks on the live data file, public/data/valuations.json.
 *
 * Both deployment workflows run the test suite before building, so a data file
 * that fails here is never deployed: the previous version of the site stays
 * live instead. That matters most on GitHub Pages, where the file arrives by
 * hand upload rather than through the publish endpoint.
 *
 * Unlike the other suites these make no assumption about how many snapshots
 * the file holds, so they keep passing as releases are added.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateDcf } from '../shared/dcf';
import { currentSnapshot } from '../shared/snapshot';
import { isValuationFile, validateSnapshot } from '../shared/validation';
import type { ValuationFile } from '../shared/types';

const text = readFileSync(resolve(process.cwd(), 'public/data/valuations.json'), 'utf8');

describe('the live data file', () => {
  it('is valid JSON', () => {
    expect(() => JSON.parse(text)).not.toThrow();
  });

  const file = JSON.parse(text) as ValuationFile;

  it('matches the file shape the site expects', () => {
    expect(isValuationFile(file)).toBe(true);
  });

  it('has at least one snapshot, and the current pointer names one of them', () => {
    expect(file.snapshots.length).toBeGreaterThan(0);
    expect(file.snapshots.some((snapshot) => snapshot.id === file.current)).toBe(true);
  });

  it('never repeats a snapshot id', () => {
    const ids = file.snapshots.map((snapshot) => snapshot.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has a current snapshot with no blocking validation problems', () => {
    const current = currentSnapshot(file);
    expect(current).not.toBeNull();
    const validation = validateSnapshot(current);
    expect(validation.errors.map((issue) => `${issue.path}: ${issue.message}`)).toEqual([]);
  });

  it('stores results that follow from its own inputs, so nobody hand-edited the headline numbers', () => {
    const current = currentSnapshot(file)!;
    const run = calculateDcf(current.historical, current.assumptions);
    const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 1e-6);
    expect(close(current.results.enterpriseValue, run.enterpriseValue)).toBe(true);
    expect(close(current.results.equityValue, run.equityValue)).toBe(true);
    expect(close(current.results.intrinsicValuePerShare, run.intrinsicValuePerShare)).toBe(true);
  });
});
