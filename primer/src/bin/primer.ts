#!/usr/bin/env node
// primer launcher. node:sqlite needs `--experimental-sqlite` on Node 22.5–23.x and
// emits an ExperimentalWarning before Node 24. To keep behavior correct AND keep the
// MCP stdio stream clean, we re-exec ONCE with the right flag + NODE_NO_WARNINGS when
// needed. On Node 24+ (where node:sqlite is stable) this is a no-op — no extra process.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

function sqliteLoadsWithoutFlag(): boolean {
  try {
    createRequire(import.meta.url)('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

const relaunched = process.env.PRIMER_RELAUNCHED === '1';
const nodeMajor = Number(process.versions.node.split('.')[0]);
const needsFlag = !sqliteLoadsWithoutFlag();
const needsWarnSuppress = nodeMajor < 24;

if (!relaunched && (needsFlag || needsWarnSuppress)) {
  const execArgv = [...process.execArgv];
  if (needsFlag && !execArgv.includes('--experimental-sqlite')) execArgv.unshift('--experimental-sqlite');
  const child = spawnSync(process.execPath, [...execArgv, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, PRIMER_RELAUNCHED: '1', NODE_NO_WARNINGS: '1' },
  });
  process.exit(child.status ?? 1);
}

const { run } = await import('../cli/index.js');
await run(process.argv);
