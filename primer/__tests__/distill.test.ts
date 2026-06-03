import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { connect } from '../src/db/index.js';
import { buildDigest } from '../src/learn/distill.js';
import { pendingCount, recordSignal } from '../src/learn/signals.js';
import { tmpDir } from './_tmp.js';

describe('distillation digest', () => {
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

  it('is empty when there are no signals', async () => {
    const d = await buildDigest(db);
    expect(d.included).toBe(0);
    expect(d.instructions).toMatch(/no pending/i);
  });

  it('bounds the digest, consumes signals, and surfaces AST candidates', async () => {
    for (let i = 0; i < 40; i++) recordSignal(db, { filePath: `src/f${i}.ts`, before: `var x${i} = ${i}`, after: `const x${i} = ${i}`, cwd: t.dir });
    expect(pendingCount(db)).toBe(40);
    const d = await buildDigest(db, { limit: 30 });
    expect(d.included).toBe(30);
    expect(d.remaining).toBe(10);
    expect(d.signals.length).toBe(30);
    expect(pendingCount(db)).toBe(10); // consumed
    expect(d.contract).toMatch(/AT MOST 8/);
    // AST-derived candidate: 30 var->const edits aggregate into one high-support candidate.
    expect(d.candidates.some((c) => c.category === 'structure' && c.support === 30)).toBe(true);
  });

  it('does not consume when consume:false', async () => {
    recordSignal(db, { filePath: 'src/a.ts', after: 'const a = 1', cwd: t.dir });
    await buildDigest(db, { consume: false });
    expect(pendingCount(db)).toBe(1);
  });
});
