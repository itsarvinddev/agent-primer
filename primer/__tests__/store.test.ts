import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { connect } from '../src/db/index.js';
import { buildBrief, forgetPreference, getPreference, queryPreferences, recordPreference } from '../src/graph/store.js';
import { tmpDir } from './_tmp.js';

describe('style-graph store', () => {
  let t: ReturnType<typeof tmpDir>;
  let db: DatabaseSync;
  beforeEach(() => {
    t = tmpDir();
    db = connect(t.db, { create: true });
  });
  afterEach(() => {
    db.close();
    t.cleanup();
  });

  it('records and reads back a preference', () => {
    const r = recordPreference(db, { category: 'testing', statement: 'Use vitest for unit tests', language: 'typescript' });
    expect(r.status).toBe('recorded');
    expect(r.preference?.id).toBeGreaterThan(0);
    const got = getPreference(db, r.preference!.id);
    expect(got?.statement).toBe('Use vitest for unit tests');
    expect(got?.language).toBe('typescript');
  });

  it('rejects a non-enum category', () => {
    expect(() => recordPreference(db, { category: 'bogus', statement: 'x y z' })).toThrow(/invalid category/);
  });

  it('rejects multi-line / over-long / task-specific statements', () => {
    expect(() => recordPreference(db, { category: 'naming', statement: 'a'.repeat(300) })).toThrow(/too long/);
    expect(() => recordPreference(db, { category: 'naming', statement: 'fix the bug in this file' })).toThrow(/task-specific/);
  });

  it('reinforces on exact duplicate (weight up, not duplicated)', () => {
    recordPreference(db, { category: 'tooling', statement: 'Prefer pnpm over npm' });
    const again = recordPreference(db, { category: 'tooling', statement: 'Prefer pnpm over npm' });
    expect(again.status).toBe('reinforced');
    expect(again.preference?.weight).toBe(2);
    const all = queryPreferences(db, { text: 'pnpm' });
    expect(all.length).toBe(1);
  });

  it('gates near-duplicates unless forced', () => {
    recordPreference(db, { category: 'testing', statement: 'Use vitest for tests' });
    const near = recordPreference(db, { category: 'testing', statement: 'Use vitest for the tests' });
    expect(near.status).toBe('needs_review');
    expect(near.similar.length).toBeGreaterThan(0);
    const forced = recordPreference(db, { category: 'testing', statement: 'Use vitest for the tests', force: true });
    expect(forced.status).toBe('recorded');
  });

  it('supersedes: old becomes forgotten + an edge is recorded', () => {
    const a = recordPreference(db, { category: 'imports', statement: 'Use relative imports' });
    const b = recordPreference(db, { category: 'imports', statement: 'Use absolute imports from src', supersedes: a.preference!.id });
    expect(b.status).toBe('recorded');
    expect(getPreference(db, a.preference!.id)?.status).toBe('forgotten');
    const edge = db.prepare('SELECT * FROM pref_edges WHERE source_id = ? AND target_id = ? AND kind = ?').get(b.preference!.id, a.preference!.id, 'supersedes');
    expect(edge).toBeTruthy();
  });

  it('detects a polarity conflict and links it', () => {
    const a = recordPreference(db, { category: 'comments', statement: 'Add docstrings to exported functions' });
    const b = recordPreference(db, { category: 'comments', statement: 'Do not add docstrings to exported functions', force: true });
    expect(b.conflicts.map((c) => c.id)).toContain(a.preference!.id);
  });

  it('forget soft-deletes (and hard removes)', () => {
    const a = recordPreference(db, { category: 'async', statement: 'Prefer async/await over .then chains' });
    expect(forgetPreference(db, { id: a.preference!.id }).forgotten).toBe(1);
    expect(getPreference(db, a.preference!.id)?.status).toBe('forgotten');
    forgetPreference(db, { id: a.preference!.id, hard: true });
    expect(getPreference(db, a.preference!.id)).toBeNull();
  });

  it('buildBrief returns bounded, ranked items', () => {
    recordPreference(db, { category: 'testing', statement: 'Use vitest for unit tests' });
    recordPreference(db, { category: 'tooling', statement: 'Prefer pnpm over npm' });
    const items = buildBrief([db], { limit: 10 });
    expect(items.length).toBe(2);
    expect(items[0]).toHaveProperty('rank');
  });
});
