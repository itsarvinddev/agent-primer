import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpDir } from './_tmp.js';

const LAUNCHER = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'bin', 'primer.js');

describe('primer MCP server (stdio)', () => {
  let t: ReturnType<typeof tmpDir>;
  let proc: ChildProcess;
  let firstStdoutLine: string | null = null;
  const pending = new Map<number, (m: any) => void>();

  beforeEach(() => {
    if (!existsSync(LAUNCHER)) throw new Error(`launcher not built at ${LAUNCHER} (run npm run build)`);
    t = tmpDir();
    firstStdoutLine = null;
    proc = spawn(process.execPath, [LAUNCHER, 'serve', '--mcp'], {
      env: { ...process.env, PRIMER_DB: t.db, PRIMER_RELAUNCHED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buf = '';
    proc.stdout!.on('data', (d) => {
      buf += d.toString();
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        if (firstStdoutLine === null) firstStdoutLine = line;
        try {
          const msg = JSON.parse(line);
          if (msg.id != null && pending.has(msg.id)) {
            pending.get(msg.id)!(msg);
            pending.delete(msg.id);
          }
        } catch {
          /* non-JSON line — leave for the assertion to catch */
        }
      }
    });
  });

  afterEach(() => {
    proc.kill();
    t.cleanup();
  });

  function send(msg: unknown): void {
    proc.stdin!.write(JSON.stringify(msg) + '\n');
  }
  function request(id: number, method: string, params: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error(`timeout: ${method}`)), 8000);
      pending.set(id, (m) => {
        clearTimeout(to);
        resolve(m);
      });
      send({ jsonrpc: '2.0', id, method, params });
    });
  }

  it('initializes with a clean stdout stream and round-trips record -> apply', async () => {
    const init = await request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    // The single most important guard: the first stdout byte must be JSON-RPC,
    // never a node:sqlite ExperimentalWarning or a stray banner.
    expect(() => JSON.parse(firstStdoutLine!)).not.toThrow();
    expect(init.result.serverInfo.name).toBe('primer');

    send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    const list = await request(2, 'tools/list', {});
    expect(list.result.tools.map((x: any) => x.name).sort()).toEqual([
      'primer_apply',
      'primer_impact',
      'primer_learn',
      'primer_query',
      'primer_record',
      'primer_status',
    ]);

    const rec = await request(3, 'tools/call', {
      name: 'primer_record',
      arguments: { category: 'testing', statement: 'Use vitest for unit tests', source: 'user-stated' },
    });
    expect(rec.result.content[0].text).toMatch(/recorded|reinforced/);

    const apply = await request(4, 'tools/call', { name: 'primer_apply', arguments: {} });
    expect(apply.result.content[0].text).toMatch(/vitest/);
  });
});
