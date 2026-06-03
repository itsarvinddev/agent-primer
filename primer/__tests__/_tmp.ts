import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tmpDir(): { dir: string; db: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'primer-'));
  return { dir, db: join(dir, 'primer.db'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
