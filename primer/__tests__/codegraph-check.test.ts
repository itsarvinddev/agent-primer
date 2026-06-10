import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from './_tmp.js';

// Exercise the BUILT hook end-to-end as a subprocess, hermetically: a bare PATH (no
// real codegraph, no curl/sh) plus AGENT_PRIMER_NO_PATH_AUGMENT so the host machine's
// installed codegraph can never leak in. A fake `codegraph` shim covers the CLI-present
// branches without touching the network.

const LAUNCHER = join(process.cwd(), 'dist', 'bin', 'primer.js');

function runCheck(args: string[], env: Record<string, string>): string {
  const r = spawnSync(process.execPath, [LAUNCHER, 'codegraph-check', '--format', 'text', ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...env, PRIMER_RELAUNCHED: '1', AGENT_PRIMER_NO_PATH_AUGMENT: '1' },
  });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

// A codegraph shim whose `init -i` writes a real-looking index db.
function writeFakeCodegraph(binDir: string): void {
  mkdirSync(binDir, { recursive: true });
  const shim = join(binDir, 'codegraph');
  writeFileSync(
    shim,
    `#!/bin/sh
PATH=/usr/bin:/bin   # the hook runs us on a bare PATH; coreutils live here on mac+linux
case "$1" in
  --version) echo 0.0.0-test ;;
  install) exit 0 ;;
  init) mkdir -p .codegraph && : > .codegraph/codegraph.db ;;
  status) echo "index ok" ;;
esac
exit 0
`,
  );
  chmodSync(shim, 0o755);
}

// The fake-CLI shim is a /bin/sh script — these subprocess tests only run on POSIX.
// (CI covers Windows for the rest of the suite; the check's win32 branches are
// shell-resolution and powershell paths exercised via commandExists/runShell.)
describe.skipIf(process.platform === 'win32')('codegraph-check (npm hook)', () => {
  let t: ReturnType<typeof tmpDir>;
  let home: string;
  let env: Record<string, string>;

  beforeEach(() => {
    t = tmpDir();
    home = join(t.dir, 'home');
    mkdirSync(home, { recursive: true });
    env = {
      PATH: join(t.dir, 'emptybin'),
      HOME: home,
      USERPROFILE: home,
      AGENT_PRIMER_STATE_DIR: join(home, '.agent-primer'),
    };
    mkdirSync(env.PATH, { recursive: true });
  });
  afterEach(() => t.cleanup());

  it('CLI missing + bootstrap in a NON-git dir: soft note, no STOP, nothing indexed', () => {
    const proj = join(t.dir, 'scratch');
    mkdirSync(proj);
    const out = runCheck(['--project', proj, '--bootstrap'], env);
    expect(out).toContain('[CodeGraph not set up here]');
    expect(out).not.toContain('STOP:');
    expect(existsSync(join(proj, '.codegraph'))).toBe(false);
  });

  it('CLI missing + bootstrap + recent failed attempt: backs off to instructions with -y', () => {
    const proj = join(t.dir, 'repo');
    mkdirSync(join(proj, '.git'), { recursive: true });
    mkdirSync(env.AGENT_PRIMER_STATE_DIR, { recursive: true });
    writeFileSync(join(env.AGENT_PRIMER_STATE_DIR, 'codegraph-install.last-attempt'), '');
    const out = runCheck(['--project', proj, '--bootstrap'], env);
    expect(out).toContain('[CodeGraph setup required before task work]');
    expect(out).toContain('codegraph install -y');
  });

  it('CLI present + bootstrap on a git repo: indexes, gitignores, emits the projectPath recovery hint', () => {
    const bin = join(t.dir, 'fakebin');
    writeFakeCodegraph(bin);
    const proj = join(t.dir, 'repo2');
    mkdirSync(join(proj, '.git'), { recursive: true });
    const out = runCheck(['--project', proj, '--bootstrap'], { ...env, PATH: bin });
    expect(out).toContain('[CodeGraph bootstrap complete]');
    expect(out).toContain('No CodeGraph project is loaded'); // the MCP recovery hint
    expect(existsSync(join(proj, '.codegraph', 'codegraph.db'))).toBe(true);
    expect(readFileSync(join(proj, '.gitignore'), 'utf8')).toMatch(/^\.codegraph\/$/m);
  });

  it('a FRESH bare .codegraph dir means another indexer is running: do not stack a second one', () => {
    const bin = join(t.dir, 'fakebin-progress');
    writeFakeCodegraph(bin);
    const proj = join(t.dir, 'inflight');
    mkdirSync(join(proj, '.git'), { recursive: true });
    mkdirSync(join(proj, '.codegraph'), { recursive: true }); // just created → fresh mtime, no db
    const out = runCheck(['--project', proj, '--bootstrap'], { ...env, PATH: bin });
    expect(out).toContain('[CodeGraph indexing in background]');
    expect(out).toContain('already appears to be in progress');
    expect(existsSync(join(proj, '.codegraph', 'codegraph.db'))).toBe(false); // no second init ran
  });

  it('a bare .codegraph dir without a db does NOT count as initialized', () => {
    const bin = join(t.dir, 'fakebin2');
    writeFakeCodegraph(bin);
    const proj = join(t.dir, 'halfbuilt');
    mkdirSync(join(proj, '.codegraph'), { recursive: true }); // aborted init: dir, no db
    const out = runCheck(['--project', proj], { ...env, PATH: bin });
    expect(out).toContain('NOT indexed');
    expect(out).toContain('codegraph init -i');
  });

  it('once-mode: silent when the index db exists', () => {
    const bin = join(t.dir, 'fakebin3');
    writeFakeCodegraph(bin);
    const proj = join(t.dir, 'done');
    mkdirSync(join(proj, '.codegraph'), { recursive: true });
    writeFileSync(join(proj, '.codegraph', 'codegraph.db'), '');
    const out = runCheck(['--project', proj], { ...env, PATH: bin });
    expect(out.trim()).toBe('');
  });
});
