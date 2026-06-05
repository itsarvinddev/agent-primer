import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
// Import the BUILT installer so import.meta.url resolves the launcher the same way
// it does in production (dist/installer -> dist/bin/primer.js).
import { entryForScript, runInstall, runUninstall } from '../dist/installer/index.js';
import { runSetup, runTeardown } from '../dist/kit/setup.js';
import { tmpDir } from './_tmp.js';

describe('installer', () => {
  let t: ReturnType<typeof tmpDir>;
  beforeEach(() => {
    t = tmpDir();
  });
  afterEach(() => t.cleanup());

  it('writes an absolute-path MCP entry for claude (local) and reverses it', () => {
    runInstall({ targets: ['claude'], cwd: t.dir, location: 'local' });
    const file = join(t.dir, '.mcp.json');
    const cfg = JSON.parse(readFileSync(file, 'utf8'));
    expect(cfg.mcpServers.primer.command).toBe(process.execPath);
    expect(cfg.mcpServers.primer.args[0]).toMatch(/dist[/\\]bin[/\\]primer\.js$/);
    expect(cfg.mcpServers.primer.args).toContain('serve');
    expect(cfg.mcpServers.primer.args).toContain('--mcp');

    runUninstall({ targets: ['claude'], cwd: t.dir, location: 'local' });
    expect(JSON.parse(readFileSync(file, 'utf8')).mcpServers.primer).toBeUndefined();
  });

  it('uses opencode array-command shape', () => {
    runInstall({ targets: ['opencode'], cwd: t.dir, location: 'local' });
    const cfg = JSON.parse(readFileSync(join(t.dir, 'opencode.json'), 'utf8'));
    expect(cfg.mcp.primer.type).toBe('local');
    expect(Array.isArray(cfg.mcp.primer.command)).toBe(true);
    expect(cfg.mcp.primer.command[0]).toBe(process.execPath);
  });

  it('writes Codex MCP config project-locally for local installs', () => {
    runInstall({ targets: ['codex'], cwd: t.dir, location: 'local' });
    const local = readFileSync(join(t.dir, '.codex', 'config.toml'), 'utf8');
    expect(local).toContain('[mcp_servers.primer]');
    expect(local).toContain('serve');

    runUninstall({ targets: ['codex'], cwd: t.dir, location: 'local' });
    expect(readFileSync(join(t.dir, '.codex', 'config.toml'), 'utf8')).not.toContain('[mcp_servers.primer]');
  });

  it('refuses to clobber invalid JSON', () => {
    const { writeFileSync } = require('node:fs');
    writeFileSync(join(t.dir, '.mcp.json'), '{ broken');
    expect(() => runInstall({ targets: ['claude'], cwd: t.dir, location: 'local' })).not.toThrow();
    // the broken file is left as-is (install reported a failure but didn't crash)
    expect(readFileSync(join(t.dir, '.mcp.json'), 'utf8')).toBe('{ broken');
    expect(existsSync(join(t.dir, '.mcp.json.primer.tmp'))).toBe(false);
  });
});

describe('entryForScript (transient-path guard)', () => {
  it('wires a self-healing npx command for a launcher in npx cache (never bakes the _npx path)', () => {
    const e = entryForScript('/Users/x/.npm/_npx/abc123/node_modules/@agent-primer/primer/dist/bin/primer.js', '/usr/bin/node');
    expect(e.command).toBe('npx');
    expect(e.args).toEqual(['-y', '@agent-primer/primer', 'serve', '--mcp']);
  });

  it('wires the absolute node + script path for a stable install', () => {
    const e = entryForScript('/opt/app/primer/dist/bin/primer.js', '/usr/bin/node');
    expect(e.command).toBe('/usr/bin/node');
    expect(e.args).toEqual(['/opt/app/primer/dist/bin/primer.js', 'serve', '--mcp']);
  });
});

describe('native npm setup', () => {
  let t: ReturnType<typeof tmpDir>;
  beforeEach(() => {
    t = tmpDir();
  });
  afterEach(() => t.cleanup());

  it('wires core policies plus primer without bash hooks', async () => {
    await runSetup(['--project', t.dir, '--agents', 'codex']);

    const instructions = readFileSync(join(t.dir, 'AGENTS.md'), 'utf8');
    expect(instructions).toContain('codegraph-session-startup:start');
    expect(instructions).toContain('karpathy-guidelines:start');
    expect(instructions).toContain('superpowers:start');
    expect(instructions).toContain('primer:start');

    const hooks = readFileSync(join(t.dir, '.codex', 'hooks.json'), 'utf8');
    expect(hooks).toContain('codegraph-check --format text');
    expect(hooks).toContain('brief --format text --nudge');
    expect(hooks).not.toContain('bash ');

    const mcp = readFileSync(join(t.dir, '.codex', 'config.toml'), 'utf8');
    expect(mcp).toContain('[mcp_servers.primer]');
    expect(mcp).toContain('serve');

    await runTeardown(['--project', t.dir, '--agents', 'codex', '--purge']);
    expect(existsSync(join(t.dir, '.primer'))).toBe(false);
  });
});
