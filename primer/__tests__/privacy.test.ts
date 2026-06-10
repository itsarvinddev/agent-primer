import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { connect } from '../src/db/index.js';
import { capExcerpt, scrubSecrets, shouldCapture } from '../src/learn/privacy.js';
import { parseHookPayload, pendingCount, recordSignal } from '../src/learn/signals.js';
import { tmpDir } from './_tmp.js';

describe('privacy filters', () => {
  it('captures source files but rejects deps/secret/generated/large', () => {
    expect(shouldCapture('src/app.ts', 'const x = 1').ok).toBe(true);
    expect(shouldCapture('node_modules/lib/index.js', 'x').ok).toBe(false);
    expect(shouldCapture('config/secrets.ts', 'x').ok).toBe(false);
    expect(shouldCapture('app.min.js', 'x').ok).toBe(false);
    expect(shouldCapture('src/gen.ts', '// @generated\nconst x=1').ok).toBe(false);
    expect(shouldCapture('README.md', 'x').ok).toBe(false); // not a source file
    expect(shouldCapture('src/big.ts', 'x'.repeat(2 * 1024 * 1024)).ok).toBe(false);
  });

  it('scrubs secrets from excerpts', () => {
    expect(scrubSecrets('const k = "AKIAIOSFODNN7EXAMPLE"')).toContain('[REDACTED_AWS_KEY]');
    expect(scrubSecrets('api_key = "abcdef1234567890"')).toContain('[REDACTED]');
    expect(scrubSecrets('Authorization: Bearer abcdef1234567890ABCDEF')).toContain('[REDACTED]');
    expect(scrubSecrets('const x = 1')).toBe('const x = 1');
  });

  it('scrubs modern API keys and JWTs', () => {
    expect(scrubSecrets(`fetch(url, { key: "sk-ant-api03-${'a'.repeat(24)}" })`)).toContain('[REDACTED_API_KEY]');
    // the assignment pattern fires first here — what matters is the key is gone
    const assigned = scrubSecrets(`openai.apiKey = "sk-proj-${'b'.repeat(20)}"`);
    expect(assigned).toContain('[REDACTED');
    expect(assigned).not.toContain('sk-proj');
    const jwt = `eyJ${'h'.repeat(12)}.eyJ${'p'.repeat(12)}.${'s'.repeat(12)}`;
    expect(scrubSecrets(`auth("${jwt}")`)).toContain('[REDACTED_JWT]');
    // plain identifiers that merely start with sk are untouched
    expect(scrubSecrets('const skill = skLevel + 1')).toBe('const skill = skLevel + 1');
  });

  it('caps excerpt size', () => {
    const big = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    expect(capExcerpt(big)).toContain('…[truncated]');
  });
});

describe('signal capture', () => {
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

  it('records a source-file edit signal', () => {
    const r = recordSignal(db, { filePath: 'src/app.ts', before: 'var x=1', after: 'const x = 1', cwd: t.dir });
    expect(r.captured).toBe(true);
    expect(pendingCount(db)).toBe(1);
  });

  it('skips secret + generated files', () => {
    expect(recordSignal(db, { filePath: '.env', after: 'SECRET=abc', cwd: t.dir }).captured).toBe(false);
    expect(recordSignal(db, { filePath: 'bundle.min.js', after: 'x', cwd: t.dir }).captured).toBe(false);
    expect(pendingCount(db)).toBe(0);
  });

  it('scrubs secrets in stored excerpts', () => {
    recordSignal(db, { filePath: 'src/s.ts', after: 'const key = "AKIAIOSFODNN7EXAMPLE"', cwd: t.dir });
    const row = db.prepare('SELECT excerpt_after FROM signals LIMIT 1').get() as { excerpt_after: string };
    expect(row.excerpt_after).toContain('[REDACTED_AWS_KEY]');
  });
});

describe('parseHookPayload', () => {
  it('parses Claude Edit / Write / MultiEdit', () => {
    expect(parseHookPayload(JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'a.ts', old_string: 'a', new_string: 'b' } }))).toMatchObject({
      filePath: 'a.ts',
      before: 'a',
      after: 'b',
    });
    expect(parseHookPayload(JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'a.ts', content: 'c' } }))).toMatchObject({ after: 'c' });
    expect(parseHookPayload(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'a.ts' } }))).toBeNull();
    expect(parseHookPayload('not json')).toBeNull();
  });

  it('parses other agents generically (Kimi StrReplaceFile / WriteFile)', () => {
    expect(parseHookPayload(JSON.stringify({ tool_name: 'StrReplaceFile', tool_input: { file_path: 'k.py', old_str: 'x', new_str: 'y' } }))).toMatchObject({
      filePath: 'k.py',
      before: 'x',
      after: 'y',
    });
    expect(parseHookPayload(JSON.stringify({ tool_name: 'WriteFile', tool_input: { file_path: 'k.py', content: 'z' } }))).toMatchObject({ filePath: 'k.py', after: 'z' });
    // generic args shape (no tool_input wrapper)
    expect(parseHookPayload(JSON.stringify({ args: { filePath: 'o.js', oldString: 'p', newString: 'q' } }))).toMatchObject({ filePath: 'o.js', before: 'p', after: 'q' });
  });
});
