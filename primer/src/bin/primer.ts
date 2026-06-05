#!/usr/bin/env node
// primer launcher. Older Node 22 builds needed `--experimental-sqlite`, and
// pre-24 builds can emit an ExperimentalWarning. To keep behavior correct AND
// keep the MCP stdio stream clean, re-exec ONCE with the right flag +
// NODE_NO_WARNINGS when needed. On newer builds this is a no-op.

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
