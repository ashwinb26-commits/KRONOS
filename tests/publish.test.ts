/**
 * Publication pipeline tests.
 *
 * The GitHub read and write are injected, so these exercise the decisions the
 * server actually makes: what it refuses, what it recomputes, what it keeps,
 * and what it is about to commit.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MAX_DATA_FILE_BYTES, publishSnapshot, readJsonBody } from '../functions/_lib/publish';
import type { DataFileState, WriteResult } from '../functions/_lib/github';
import { appendSnapshot, createSnapshotId, currentSnapshot, findSnapshot, snapshotsNewestFirst, SnapshotMergeError, emptyValuationFile, diffSnapshots, valueMovements, MAX_SNAPSHOTS } from '../shared/snapshot';
import { MAX_PAYLOAD_BYTES } from '../shared/validation';
import type { ValuationFile, ValuationSnapshot } from '../shared/types';

const seedFile = JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/data/valuations.json'), 'utf8'),
) as ValuationFile;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const published = seedFile.snapshots[0];

/** A draft for a later valuation date, as the studio would prepare it. */
function draft(overrides: Partial<ValuationSnapshot> = {}): ValuationSnapshot {
  const next = clone(published);
  next.id = 'snap-2027-04-30';
  next.company = { ...next.company, valuationDate: '2027-04-30', publicationDate: '2027-04-30' };
  next.publicationNotes = 'Second release.';
  return { ...next, ...overrides };
}

interface Harness {
  deps: Parameters<typeof publishSnapshot>[1];
  written: Array<{ content: string; sha: string | null; message: string }>;
  readFile: ReturnType<typeof vi.fn>;
}

function harness(state: DataFileState, writeImpl?: () => Promise<WriteResult>): Harness {
  const written: Harness['written'] = [];
  const readFile = vi.fn(async () => state);
  return {
    written,
    readFile,
    deps: {
      publishedBy: 'analyst-one',
      now: () => new Date('2027-05-01T10:00:00.000Z'),
      readFile,
      writeFile: async (input) => {
        written.push(input);
        if (writeImpl) return writeImpl();
        return { commitSha: 'commit-sha-1234567890', commitUrl: 'https://github.com/o/r/commit/abc', fileSha: 'new-file-sha' };
      },
    },
  };
}

const liveFile = (file: ValuationFile = seedFile): DataFileState => ({
  content: JSON.stringify(file, null, 2),
  sha: 'live-sha',
});

describe('a clean publication', () => {
  it('commits the file and reports the commit', async () => {
    const h = harness(liveFile());
    const outcome = await publishSnapshot(
      { snapshot: draft(), baseFileSha: 'live-sha', acknowledgeWarnings: true },
      h.deps,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.commitSha).toBe('commit-sha-1234567890');
    expect(outcome.snapshotCount).toBe(2);
    expect(h.written).toHaveLength(1);
  });

  it('writes with the SHA it just read, not one the client supplied', async () => {
    const h = harness(liveFile());
    await publishSnapshot({ snapshot: draft(), baseFileSha: 'live-sha', acknowledgeWarnings: true }, h.deps);
    expect(h.written[0].sha).toBe('live-sha');
  });

  it('keeps every snapshot that was already published, byte for byte', async () => {
    const h = harness(liveFile());
    await publishSnapshot({ snapshot: draft(), baseFileSha: 'live-sha', acknowledgeWarnings: true }, h.deps);

    const result = JSON.parse(h.written[0].content) as ValuationFile;
    expect(result.snapshots).toHaveLength(2);
    expect(result.snapshots.find((entry) => entry.id === published.id)).toEqual(published);
  });

  it('points the current pointer at the new snapshot', async () => {
    const h = harness(liveFile());
    const outcome = await publishSnapshot(
      { snapshot: draft(), baseFileSha: 'live-sha', acknowledgeWarnings: true },
      h.deps,
    );
    if (!outcome.ok) throw new Error('expected success');
    const result = JSON.parse(h.written[0].content) as ValuationFile;
    expect(result.current).toBe(outcome.snapshotId);
  });

  it('records who published it and when, from the server, not the payload', async () => {
    const h = harness(liveFile());
    await publishSnapshot(
      {
        snapshot: draft({ publishedBy: 'someone-else', createdAt: '1999-01-01T00:00:00.000Z' }),
        baseFileSha: 'live-sha',
        acknowledgeWarnings: true,
      },
      h.deps,
    );
    const result = JSON.parse(h.written[0].content) as ValuationFile;
    const added = result.snapshots.find((entry) => entry.id !== published.id)!;
    expect(added.publishedBy).toBe('analyst-one');
    expect(added.createdAt).toBe('2027-05-01T10:00:00.000Z');
  });

  it('assigns the snapshot id from the valuation date, ignoring the one sent', async () => {
    const h = harness(liveFile());
    const outcome = await publishSnapshot(
      { snapshot: draft({ id: 'snap-9999-99-99' }), baseFileSha: 'live-sha', acknowledgeWarnings: true },
      h.deps,
    );
    if (!outcome.ok) throw new Error('expected success');
    expect(outcome.snapshotId).toBe('snap-2027-04-30');
  });

  it('writes a commit message naming the snapshot and the value it implies', async () => {
    const h = harness(liveFile());
    await publishSnapshot({ snapshot: draft(), baseFileSha: 'live-sha', acknowledgeWarnings: true }, h.deps);
    expect(h.written[0].message).toContain('snap-2027-04-30');
    expect(h.written[0].message).toContain('ASIANPAINT');
    expect(h.written[0].message).toContain('analyst-one');
    expect(h.written[0].message).toContain('previously');
  });

  it('creates the file when the repository has none yet', async () => {
    const h = harness({ content: null, sha: null });
    const outcome = await publishSnapshot(
      { snapshot: draft(), baseFileSha: null, acknowledgeWarnings: true },
      h.deps,
    );
    expect(outcome.ok).toBe(true);
    expect(h.written[0].sha).toBeNull();
    const result = JSON.parse(h.written[0].content) as ValuationFile;
    expect(result.snapshots).toHaveLength(1);
  });

  it('writes formatted JSON ending in a newline, so the diff is readable', async () => {
    const h = harness(liveFile());
    await publishSnapshot({ snapshot: draft(), baseFileSha: 'live-sha', acknowledgeWarnings: true }, h.deps);
    expect(h.written[0].content.endsWith('\n')).toBe(true);
    expect(h.written[0].content).toContain('\n  "schemaVersion"');
  });
});

describe('the server does not trust the submitted results', () => {
  it('replaces them with its own calculation', async () => {
    const h = harness(liveFile());
    const tampered = draft({
      results: {
        enterpriseValue: 999999,
        equityValue: 999999,
        intrinsicValuePerShare: 99999,
        terminalValueShareOfEnterpriseValuePct: 1,
        waccPct: 1,
      },
    });

    const outcome = await publishSnapshot(
      { snapshot: tampered, baseFileSha: 'live-sha', acknowledgeWarnings: true },
      h.deps,
    );
    if (!outcome.ok) throw new Error('expected success');

    expect(outcome.results.intrinsicValuePerShare).not.toBe(99999);
    expect(outcome.results.intrinsicValuePerShare).toBeCloseTo(published.results.intrinsicValuePerShare, 2);

    const result = JSON.parse(h.written[0].content) as ValuationFile;
    const added = result.snapshots.find((entry) => entry.id === outcome.snapshotId)!;
    expect(added.results).toEqual(outcome.results);
  });

  it('refuses a payload whose assumptions cannot be valued', async () => {
    const h = harness(liveFile());
    const broken = draft();
    broken.assumptions = { ...broken.assumptions, capexPctRevenue: 95 };
    const outcome = await publishSnapshot(
      { snapshot: broken, baseFileSha: 'live-sha', acknowledgeWarnings: true },
      h.deps,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(422);
    expect(h.written).toHaveLength(0);
  });

  it('strips control characters out of free text before storing it', async () => {
    const h = harness(liveFile());
    const messy = draft();
    messy.company = { ...messy.company, researchNotes: 'clean\u0000notes' };
    await publishSnapshot({ snapshot: messy, baseFileSha: 'live-sha', acknowledgeWarnings: true }, h.deps);
    expect(h.written[0].content).not.toContain('\\u0000');
    expect(h.written[0].content).toContain('cleannotes');
  });
});

describe('validation gates the write', () => {
  it('refuses a payload that does not validate, and writes nothing', async () => {
    const h = harness(liveFile());
    const invalid = draft();
    invalid.company = { ...invalid.company, valuationDate: 'last Tuesday' };

    const outcome = await publishSnapshot(
      { snapshot: invalid, baseFileSha: 'live-sha', acknowledgeWarnings: true },
      h.deps,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('validation');
    expect(outcome.status).toBe(422);
    expect(outcome.issues?.length).toBeGreaterThan(0);
    expect(h.written).toHaveLength(0);
    expect(h.readFile).not.toHaveBeenCalled();
  });

  it('refuses unacknowledged warnings, and writes nothing', async () => {
    const h = harness(liveFile());
    const outcome = await publishSnapshot(
      { snapshot: draft(), baseFileSha: 'live-sha', acknowledgeWarnings: false },
      h.deps,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('unacknowledged_warnings');
    expect(outcome.status).toBe(409);
    expect(h.written).toHaveLength(0);
  });

  it('refuses an injected key rather than storing it', async () => {
    const h = harness(liveFile());
    const outcome = await publishSnapshot(
      { snapshot: { ...draft(), somethingElse: true }, baseFileSha: 'live-sha', acknowledgeWarnings: true },
      h.deps,
    );
    expect(outcome.ok).toBe(false);
    expect(h.written).toHaveLength(0);
  });

  it('refuses something that is not a snapshot at all', async () => {
    const h = harness(liveFile());
    for (const payload of [null, 'a string', 42, []]) {
      const outcome = await publishSnapshot(
        { snapshot: payload, baseFileSha: null, acknowledgeWarnings: true },
        h.deps,
      );
      expect(outcome.ok).toBe(false);
    }
    expect(h.written).toHaveLength(0);
  });
});

describe('concurrent updates', () => {
  it('refuses when the file moved on since the studio read it', async () => {
    const h = harness({ ...liveFile(), sha: 'newer-sha' });
    const outcome = await publishSnapshot(
      { snapshot: draft(), baseFileSha: 'older-sha', acknowledgeWarnings: true },
      h.deps,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('stale_data');
    expect(outcome.status).toBe(409);
    expect(h.written).toHaveLength(0);
  });

  it('refuses a second snapshot for a valuation date that is already published', async () => {
    const h = harness(liveFile());
    // The same valuation date as the published snapshot, so the server picks a
    // suffixed id rather than replacing anything.
    const outcome = await publishSnapshot(
      { snapshot: draft({ company: { ...published.company } }), baseFileSha: 'live-sha', acknowledgeWarnings: true },
      h.deps,
    );
    if (!outcome.ok) throw new Error('expected success');
    expect(outcome.snapshotId).toBe(`${published.id}-2`);

    const result = JSON.parse(h.written[0].content) as ValuationFile;
    expect(result.snapshots.map((entry) => entry.id)).toEqual([published.id, `${published.id}-2`]);
  });

  it('passes a stale-SHA rejection from GitHub straight through', async () => {
    const h = harness(liveFile(), async () => {
      const error = new Error('The data file changed in GitHub.') as Error & { code: string };
      error.code = 'stale_data';
      throw error;
    });
    const outcome = await publishSnapshot(
      { snapshot: draft(), baseFileSha: 'live-sha', acknowledgeWarnings: true },
      h.deps,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('stale_data');
    expect(outcome.status).toBe(409);
  });
});

describe('a damaged repository file', () => {
  it('refuses to overwrite invalid JSON', async () => {
    const h = harness({ content: '{ not json', sha: 'live-sha' });
    const outcome = await publishSnapshot(
      { snapshot: draft(), baseFileSha: 'live-sha', acknowledgeWarnings: true },
      h.deps,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('corrupt_data');
    expect(h.written).toHaveLength(0);
  });

  it('refuses to overwrite JSON that is not a valuation file', async () => {
    const h = harness({ content: '{"hello":"world"}', sha: 'live-sha' });
    const outcome = await publishSnapshot(
      { snapshot: draft(), baseFileSha: 'live-sha', acknowledgeWarnings: true },
      h.deps,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('corrupt_data');
    expect(h.written).toHaveLength(0);
  });

  it('treats an empty file as a fresh start rather than refusing', async () => {
    const h = harness({ content: '   ', sha: 'live-sha' });
    const outcome = await publishSnapshot(
      { snapshot: draft(), baseFileSha: 'live-sha', acknowledgeWarnings: true },
      h.deps,
    );
    expect(outcome.ok).toBe(true);
  });

  it('reports a read failure without writing', async () => {
    const written: unknown[] = [];
    const outcome = await publishSnapshot(
      { snapshot: draft(), baseFileSha: null, acknowledgeWarnings: true },
      {
        publishedBy: 'analyst-one',
        readFile: async () => {
          throw new Error('GitHub refused to read the data file.');
        },
        writeFile: async (input) => {
          written.push(input);
          return { commitSha: 'x', commitUrl: 'y', fileSha: 'z' };
        },
      },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('read_failed');
    expect(written).toHaveLength(0);
  });
});

describe('size limits', () => {
  it('has a data file ceiling below what GitHub struggles with', () => {
    expect(MAX_DATA_FILE_BYTES).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(MAX_DATA_FILE_BYTES).toBeGreaterThan(MAX_PAYLOAD_BYTES);
  });

  it('refuses a body larger than the payload ceiling before parsing it', async () => {
    const big = 'x'.repeat(MAX_PAYLOAD_BYTES + 10);
    const result = await readJsonBody(
      new Request('https://lab.example.com/api/publish', { method: 'POST', body: big }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('payload_too_large');
  });

  it('refuses a body larger than the declared content length allows', async () => {
    const result = await readJsonBody(
      new Request('https://lab.example.com/api/publish', {
        method: 'POST',
        body: '{}',
        headers: { 'content-length': String(MAX_PAYLOAD_BYTES + 1) },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('refuses a body that is not JSON', async () => {
    const result = await readJsonBody(
      new Request('https://lab.example.com/api/publish', { method: 'POST', body: 'not json' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('bad_json');
  });

  it('reads a normal body', async () => {
    const result = await readJsonBody(
      new Request('https://lab.example.com/api/publish', { method: 'POST', body: '{"snapshot":{}}' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ snapshot: {} });
  });
});

describe('snapshot bookkeeping', () => {
  it('derives an id from the valuation date and suffixes collisions', () => {
    expect(createSnapshotId('2026-04-30', [])).toBe('snap-2026-04-30');
    expect(createSnapshotId('2026-04-30', ['snap-2026-04-30'])).toBe('snap-2026-04-30-2');
    expect(createSnapshotId('2026-04-30', ['snap-2026-04-30', 'snap-2026-04-30-2'])).toBe('snap-2026-04-30-3');
  });

  it('refuses to append over an existing id', () => {
    expect(() => appendSnapshot(seedFile, published)).toThrow(SnapshotMergeError);
  });

  it('refuses to grow past the snapshot limit', () => {
    const full: ValuationFile = {
      ...emptyValuationFile(),
      snapshots: Array.from({ length: MAX_SNAPSHOTS }, (_, index) => ({
        ...clone(published),
        id: `snap-filler-${index}`,
      })),
    };
    expect(() => appendSnapshot(full, { ...clone(published), id: 'snap-new' })).toThrow(/Archive the oldest/);
  });

  it('keeps snapshots in valuation-date order and finds them by id', () => {
    const older = { ...clone(published), id: 'snap-2020-01-01' };
    older.company = { ...older.company, valuationDate: '2020-01-01' };
    const merged = appendSnapshot({ ...emptyValuationFile(), snapshots: [clone(published)], current: published.id }, older);

    expect(merged.snapshots.map((entry) => entry.id)).toEqual(['snap-2020-01-01', published.id]);
    expect(merged.current).toBe('snap-2020-01-01');
    expect(findSnapshot(merged, published.id)?.id).toBe(published.id);
    expect(findSnapshot(merged, 'nope')).toBeNull();
    expect(snapshotsNewestFirst(merged)[0].id).toBe(published.id);
  });

  it('falls back to the last snapshot when the current pointer is wrong', () => {
    const broken: ValuationFile = { ...seedFile, current: 'missing' };
    expect(currentSnapshot(broken)?.id).toBe(published.id);
    expect(currentSnapshot(emptyValuationFile())).toBeNull();
  });
});

describe('the diff the studio previews', () => {
  it('reports a first release when nothing is published', () => {
    const diff = diffSnapshots(null, clone(published));
    expect(diff.meta[0].label).toMatch(/First published snapshot/);
  });

  it('finds a changed historical figure, by year and line', () => {
    const next = clone(published);
    next.historical[2].revenue = 36500;
    const diff = diffSnapshots(published, next);
    const change = diff.historical.find((entry) => entry.path.endsWith('.revenue'));
    expect(change?.label).toContain(next.historical[2].year);
    expect(change?.before).toBe('36000');
    expect(change?.after).toBe('36500');
  });

  it('finds a changed assumption, including one nested in the cost of capital', () => {
    const next = clone(published);
    next.assumptions.terminalGrowthPct = 3.5;
    next.assumptions.wacc!.betaLevered = 0.9;
    const diff = diffSnapshots(published, next);
    const paths = diff.assumptions.map((entry) => entry.path);
    expect(paths).toContain('assumptions.terminalGrowthPct');
    expect(paths).toContain('assumptions.wacc.betaLevered');
  });

  it('finds an added and a removed year', () => {
    const next = clone(published);
    next.historical = next.historical.slice(1);
    const removed = diffSnapshots(published, next).historical.find((entry) => entry.kind === 'removed');
    expect(removed?.label).toContain('removed');

    const added = diffSnapshots(next, published).historical.find((entry) => entry.kind === 'added');
    expect(added?.label).toContain('added');
  });

  it('finds an added source document', () => {
    const next = clone(published);
    next.sources = [
      ...next.sources,
      { id: 'new-doc', label: 'New', url: 'https://example.com/x.pdf', reportYear: 'FY2025-26', retrievedOn: '2027-04-30' },
    ];
    expect(diffSnapshots(published, next).sources.map((entry) => entry.kind)).toContain('added');
  });

  it('reports nothing when nothing changed', () => {
    const diff = diffSnapshots(published, clone(published));
    const total = diff.company.length + diff.historical.length + diff.assumptions.length + diff.sources.length + diff.meta.length;
    expect(total).toBe(0);
  });

  it('reports a verification state moving to verified', () => {
    const next = clone(published);
    next.historical[4].provenance.revenue = {
      ...next.historical[4].provenance.revenue!,
      verification: 'verified',
    };
    const change = diffSnapshots(published, next).historical.find((entry) =>
      entry.path.endsWith('revenue.verification'),
    );
    expect(change?.after).toBe('verified');
  });
});

describe('the value movement the studio previews', () => {
  it('reports the change in each headline figure', () => {
    const movements = valueMovements(published.results, {
      ...published.results,
      intrinsicValuePerShare: published.results.intrinsicValuePerShare * 1.1,
    });
    const perShare = movements.find((entry) => entry.label.includes('per share'))!;
    expect(perShare.deltaPct).toBeCloseTo(10, 1);
  });

  it('reports no change against a first release', () => {
    const movements = valueMovements(null, published.results);
    expect(movements.every((entry) => entry.before === null && entry.deltaPct === null)).toBe(true);
  });
});
