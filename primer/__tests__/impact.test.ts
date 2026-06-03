import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { connect } from '../src/db/index.js';
import { recordPreference } from '../src/graph/store.js';
import { fileImpact, preferenceImpact } from '../src/graph/impact.js';
import { tmpDir } from './_tmp.js';

describe('primer_impact', () => {
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

  it('preferenceImpact returns conflict neighbors', () => {
    const a = recordPreference(db, { category: 'structure', statement: 'Use const instead of var' });
    recordPreference(db, { category: 'structure', statement: 'Never use const, prefer var', force: true });
    const imp = preferenceImpact(db, a.preference!.id);
    expect(imp.preference!.id).toBe(a.preference!.id);
    expect(imp.conflicts.length).toBeGreaterThan(0);
    expect(imp.conflicts[0].statement).toMatch(/var/i);
  });

  it('fileImpact returns AST facts + governing prefs (followed)', async () => {
    recordPreference(db, { category: 'structure', statement: 'Use const/let instead of var' });
    const imp = await fileImpact([db], 'x.ts', 'const a = 1; const b = () => a;');
    expect(imp.facts.length).toBeGreaterThan(0);
    expect(imp.governing.some((g) => g.status === 'followed')).toBe(true);
  });

  it('fileImpact ignores prefs whose category the file does not exercise', async () => {
    recordPreference(db, { category: 'testing', statement: 'Use vitest' });
    const imp = await fileImpact([db], 'x.ts', 'const a = 1;');
    expect(imp.governing.find((g) => g.category === 'testing')).toBeUndefined();
  });
});
