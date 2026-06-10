import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { dispatch, TOOLS } from '../dist/mcp/tools.js';
import { connect, initDb } from '../dist/db/index.js';
import { recordPreference } from '../dist/graph/store.js';
import { tmpDir } from './_tmp.js';

describe('MCP tool dispatch — projectPath (cwd-detection escape hatch)', () => {
  let t: ReturnType<typeof tmpDir>;
  beforeEach(() => {
    t = tmpDir();
  });
  afterEach(() => t.cleanup());

  it('every tool schema exposes projectPath', () => {
    for (const tool of TOOLS) {
      const props = (tool.inputSchema as any).properties;
      expect(props.projectPath, `${tool.name} should accept projectPath`).toBeDefined();
    }
  });

  it('primer_apply resolves the project DB through projectPath', async () => {
    const proj = join(t.dir, 'proj');
    initDb(join(proj, '.primer', 'primer.db'));
    const db = connect(join(proj, '.primer', 'primer.db'), { create: true });
    try {
      recordPreference(db, { category: 'testing', statement: 'Use vitest for unit tests' });
    } finally {
      db.close();
    }
    const res = await dispatch('primer_apply', { projectPath: proj });
    expect(res.content[0].text).toContain('Use vitest for unit tests');
  });
});
