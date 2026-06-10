import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connect, initDb } from '../dist/db/index.js';
import { MAX_PENDING_SIGNALS, pendingCount, pruneSignals, recordSignal } from '../dist/learn/signals.js';
import { tmpDir } from './_tmp.js';

describe('signal retention', () => {
  let t: ReturnType<typeof tmpDir>;
  beforeEach(() => {
    t = tmpDir();
    initDb(t.db);
  });
  afterEach(() => t.cleanup());

  it('expires processed signals past the retention window', () => {
    const db = connect(t.db, { create: true });
    try {
      db.prepare(
        "INSERT INTO signals(kind, file_path, language, excerpt_before, excerpt_after, agent, processed, created_at) VALUES('edit','old.ts','typescript','a','b',NULL,1,?)",
      ).run('2000-01-01T00:00:00.000Z');
      expect((db.prepare('SELECT COUNT(*) AS n FROM signals').get() as any).n).toBe(1);
      pruneSignals(db);
      expect((db.prepare('SELECT COUNT(*) AS n FROM signals').get() as any).n).toBe(0);
    } finally {
      db.close();
    }
  });

  it('caps the unprocessed backlog at MAX_PENDING_SIGNALS, dropping oldest first', () => {
    const db = connect(t.db, { create: true });
    try {
      const ins = db.prepare(
        "INSERT INTO signals(kind, file_path, language, excerpt_before, excerpt_after, agent, processed, created_at) VALUES('edit',?,'typescript','a','b',NULL,0,?)",
      );
      for (let i = 0; i < MAX_PENDING_SIGNALS + 25; i++) {
        ins.run(`f${i}.ts`, new Date(1700000000000 + i * 1000).toISOString());
      }
      // recordSignal runs the prune on every captured write
      const r = recordSignal(db, { filePath: 'newest.ts', after: 'const x = 1;', cwd: t.dir });
      expect(r.captured).toBe(true);
      expect(pendingCount(db)).toBe(MAX_PENDING_SIGNALS);
      // the newest signal survived; the oldest were dropped
      expect(db.prepare("SELECT COUNT(*) AS n FROM signals WHERE file_path = 'newest.ts'").get()).toMatchObject({ n: 1 });
      expect(db.prepare("SELECT COUNT(*) AS n FROM signals WHERE file_path = 'f0.ts'").get()).toMatchObject({ n: 0 });
    } finally {
      db.close();
    }
  });
});
