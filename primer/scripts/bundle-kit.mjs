// Copies the repo-root agent-primer bash kit into ./kit/ so the PUBLISHED npm package is
// self-contained: `primer setup` runs the bundled `kit/install.sh`. Runs at pack/publish
// time (package.json "prepack"); kit/ is gitignored. No-op (with a note) if the repo-root
// kit isn't reachable (e.g. building outside the monorepo).

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..'); // primer/
const repoRoot = join(pkgRoot, '..'); // the agent-primer repo root
const kitDir = join(pkgRoot, 'kit');

const fixed = ['install.sh', 'uninstall.sh', 'codegraph-session-check.sh'];
const policies = existsSync(repoRoot) ? readdirSync(repoRoot).filter((f) => f.endsWith('-policy.md')) : [];
const files = [...fixed, ...policies];

if (!existsSync(join(repoRoot, 'install.sh'))) {
  // Fail the pack/publish so we never ship a kitless tarball (which would break `primer setup`);
  // stay a soft no-op for ordinary local builds outside the monorepo.
  const onPublish = process.env.npm_lifecycle_event === 'prepack';
  console.error(`bundle-kit: repo-root kit not found${onPublish ? '' : ' (skipping)'} — \`primer setup\` needs the kit present.`);
  process.exit(onPublish ? 1 : 0);
}

mkdirSync(kitDir, { recursive: true });
let n = 0;
for (const f of files) {
  const src = join(repoRoot, f);
  if (!existsSync(src)) continue;
  copyFileSync(src, join(kitDir, f));
  n++;
}
console.error(`bundle-kit: copied ${n} kit files into primer/kit/`);
