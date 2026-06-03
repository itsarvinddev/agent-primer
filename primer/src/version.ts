// Single source of truth for the version: read it from package.json at runtime so the
// CLI/MCP version can never drift from the published package. Works in dev (from src/)
// and in the published package (from dist/ -> ../package.json at the package root, which
// npm always ships).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function readVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const VERSION = readVersion();
