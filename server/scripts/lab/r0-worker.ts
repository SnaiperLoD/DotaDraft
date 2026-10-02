// Child of reproduce-r0.ts. One production runSimulation() with
// realWinRateWeight set IN MEMORY (env LAB_RWR, default 0). Tag set comes from
// DOTADRAFT_DISABLED_TAGS (read at import by custom-tags.ts, hence a child).
import * as fs from 'fs';
import { assertLabPreconditions, setRealWinRateWeightInMemory } from './lab-common';
import { runSimulation } from '../simulate-self-play';

const seed = Number(process.env.LAB_SEED ?? 1);
const nMatches = Number(process.env.LAB_MATCHES ?? 100000);
const rwr = Number(process.env.LAB_RWR ?? 0);
const out = process.env.LAB_OUT;
if (!out) throw new Error('LAB_OUT required');

assertLabPreconditions();
setRealWinRateWeightInMemory(rwr);

const t0 = Date.now();
const res = runSimulation({ seed, nMatches, roleMode: 'blended', verbose: false, writeOutput: false });
const wallMs = Date.now() - t0;

fs.writeFileSync(out, JSON.stringify({ seed, nMatches, rwr, wallMs, heroTable: res.heroTable }, null, 2));
console.log(`worker seed=${seed} n=${nMatches} rwr=${rwr} r=${res.rFavReal?.toFixed(4)} wall=${(wallMs / 1000).toFixed(1)}s`);
