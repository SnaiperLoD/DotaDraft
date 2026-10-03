// Blind window C — one command after the fetch (Blueprint/16 "Pre-registration: blind window C"):
//   1) kt8-c-prepare: pages → c-pool/c-outcome + minimums (stops with UNDERPOWERED, no scores);
//   2) two cache builds on C (production hero-meta; proposed STRATZ hero-meta swapped in memory);
//   3) kt8-c-stzc: the one-pass acceptance test → artifacts/lab/kt8/kt8-c-stzc.json.
// No network, no server/data writes.
//   cd server && npx ts-node scripts/lab/kt8-c-run.ts
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { REPO_ROOT } from './lab-common';
import { prepareC } from './kt8-c-prepare';

const PROPOSED_META = path.join(REPO_ROOT, 'artifacts', 'stratz-refresh', '1790208000', 'hero-meta.proposed.json');
const SERVER = path.join(REPO_ROOT, 'server');
const POOL = path.join(REPO_ROOT, 'artifacts', 'lab', 'opendota-c', 'c-pool.json');

const run = (script: string, env: Record<string, string>) => {
  const r = spawnSync(process.execPath, ['-r', 'ts-node/register', path.join(__dirname, script)], { cwd: SERVER, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${script} failed (${r.status}) with ${JSON.stringify(env)}`);
};

const { pass, checks } = prepareC();
console.log(JSON.stringify({ ...checks, minimumsPass: pass }, null, 1));
if (!pass) {
  console.log('UNDERPOWERED per pre-registration — no verdict, nothing scored. A top-up pull may be decided on these counts only.');
  process.exit(0);
}
if (!fs.existsSync(PROPOSED_META)) throw new Error(`missing ${PROPOSED_META}`);
const common = { LAB_SEED: '0', LAB_POOL_FILE: POOL, DOTADRAFT_DISABLED_TAGS: '', DOTADRAFT_BATTLE_SHADOW: '' };
console.log('building cache winC-full (production hero-meta)…');
run('build-feature-cache.ts', { ...common, LAB_CACHE_LABEL: 'winC-full', LAB_VARIANT: '', LAB_HERO_META: '' });
console.log('building cache winC-full-stzc (proposed hero-meta, in-memory swap)…');
run('build-feature-cache.ts', { ...common, LAB_CACHE_LABEL: 'winC-full-stzc', LAB_VARIANT: 'stzc', LAB_HERO_META: PROPOSED_META });
run('kt8-c-stzc.ts', {});
