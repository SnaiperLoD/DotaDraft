// Variance Lab — three STRATZ tables (LAB ONLY; author ok via coordinator 2026-10-02).
// Pre-registered uses: Blueprint/16 "Pre-registration: STRATZ tables".
//   LAB_STRATZ_TABLE=positions  heroStats.winWeek + heroStats.winGameVersion by hero × position × bracket
//   LAB_STRATZ_TABLE=lanes      heroStats.laneOutcome per hero × isWith(true/false) × bracket
//   LAB_STRATZ_TABLE=stats      heroStats.stats per hero × bracket, groupByTime + groupByPosition
// Step 1 (once per table, ~3–8 cheap calls): LAB_STRATZ_INTROSPECT=1 → schema cached in
//   artifacts/lab/stratz/schema/ (arg types, enum values, return fields). The query is then
//   BUILT from that schema (all scalar fields + one nested level), so no field is guessed.
// Step 2: the pull. Dry run (LAB_DRY_RUN=1) makes no calls and uses the cached schema, if
//   present, to give the exact call count (else prints the bounds).
// Loops only over dimensions the API cannot group: heroes if a hero arg is NON_NULL,
// positions if no groupBy/flag covers position, brackets always (2: LEGEND_ANCIENT, DIVINE_IMMORTAL).
// `week`: if the field takes it and LAB_STRATZ_WEEK is set, it is passed (pre-registered
// value 1789344000 = week of 2026-09-14, disjoint from window B). Pacing ≥ 1.2 s, backoff,
// resumable; output artifacts/lab/stratz/<table>/<week|current>/<field>/<key>.json.
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR, appendRun } from './lab-common';
import { STRATZ_ROOT, cachedSchema, introspectType, namedType, selectionFor, sleep, stratzCalls, stratzPost, stratzToken, typeString, type FieldInfo } from './stratz-common';

const TABLE = process.env.LAB_STRATZ_TABLE ?? '';
const DRY = process.env.LAB_DRY_RUN === '1';
const INTRO = process.env.LAB_STRATZ_INTROSPECT === '1';
const WEEK = process.env.LAB_STRATZ_WEEK;
const GAP_MS = Number(process.env.LAB_STRATZ_GAP_MS ?? 1200);
const BRACKETS = ['LEGEND_ANCIENT', 'DIVINE_IMMORTAL'];
const POSITIONS = ['POSITION_1', 'POSITION_2', 'POSITION_3', 'POSITION_4', 'POSITION_5'];
const FIELDS: Record<string, string[]> = { positions: ['winWeek', 'winGameVersion'], lanes: ['laneOutcome'], stats: ['stats'] };
if (!FIELDS[TABLE]) throw new Error('LAB_STRATZ_TABLE must be positions | lanes | stats');

interface Plan {
  field: string;
  heroLoop: boolean;
  posLoop: boolean;
  isWithLoop: boolean;
  argNames: string[];
  calls: number;
  known: boolean;
}

function argPlan(f: FieldInfo | null, field: string, nHeroes: number): Plan {
  if (!f) {
    // unknown schema: upper bound = per hero × bracket (× isWith for lanes)
    const iw = TABLE === 'lanes' ? 2 : 1;
    return { field, heroLoop: true, posLoop: false, isWithLoop: TABLE === 'lanes', argNames: [], calls: nHeroes * BRACKETS.length * iw, known: false };
  }
  const names = f.args.map((a) => a.name);
  const heroArg = f.args.find((a) => /^heroIds?$/i.test(a.name));
  const heroLoop = !!heroArg && heroArg.type.kind === 'NON_NULL';
  const groupByEnum = f.args.find((a) => /^groupBy$/i.test(a.name));
  const groupEnumVals = groupByEnum ? (cachedSchema<any>(`type-${namedType(groupByEnum.type).name}.json`)?.enumValues ?? []).map((v: { name: string }) => v.name) : [];
  const posCovered = names.some((n) => /groupByPosition/i.test(n)) || groupEnumVals.some((v: string) => /POSITION/.test(v));
  const posFilter = names.some((n) => /^positionIds?$/i.test(n));
  const posLoop = !posCovered && posFilter && TABLE === 'positions';
  const isWithLoop = names.includes('isWith');
  const calls = (heroLoop ? nHeroes : 1) * BRACKETS.length * (posLoop ? POSITIONS.length : 1) * (isWithLoop ? 2 : 1);
  return { field, heroLoop, posLoop, isWithLoop, argNames: names, calls, known: true };
}

function valueFor(argName: string, t: FieldInfo['args'][number]['type'], ctx: { heroId?: number; bracket: string; pos?: string; isWith?: boolean }, groupVals: string[]): unknown {
  const ts = typeString(t);
  const list = ts.startsWith('[');
  const wrap = (v: unknown) => (list ? [v] : v);
  if (/^heroIds?$/i.test(argName)) return ctx.heroId === undefined ? undefined : wrap(ctx.heroId);
  if (/^bracketBasicIds?$/i.test(argName)) return wrap(ctx.bracket);
  if (/^bracketIds?$/i.test(argName)) return ctx.bracket === 'LEGEND_ANCIENT' ? ['LEGEND', 'ANCIENT'] : ['DIVINE', 'IMMORTAL'];
  if (/^positionIds?$/i.test(argName)) return ctx.pos ? wrap(ctx.pos) : undefined;
  if (argName === 'isWith') return ctx.isWith;
  if (/^groupByPosition$/i.test(argName) || /^groupByTime$/i.test(argName)) return true;
  if (/^groupBy$/i.test(argName)) {
    const pick = groupVals.find((v) => /HERO/.test(v) && /POSITION/.test(v) && /BRACKET/.test(v)) ?? groupVals.find((v) => /HERO/.test(v) && /POSITION/.test(v)) ?? groupVals.find((v) => /POSITION/.test(v));
    return pick;
  }
  // positions: winWeek/winGameVersion are time series already — no week filter (patch stability needs several)
  if (argName === 'week' && WEEK && TABLE !== 'positions') return Number(WEEK);
  return undefined;
}

async function main() {
  const heroes = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'heroes.json'), 'utf-8')) as { id: number }[];
  const ids = heroes.map((h) => h.id);
  const tok = stratzToken();
  const hsq = cachedSchema<any>('type-HeroStatsQuery.json');
  const fieldInfo = (name: string): FieldInfo | null => (hsq?.fields as FieldInfo[] | undefined)?.find((f) => f.name === name) ?? null;
  if (INTRO) {
    if (!tok) throw new Error('STRATZ_API_TOKEN not found');
    const q = await introspectType(tok, 'HeroStatsQuery');
    for (const fname of FIELDS[TABLE]) {
      const f = (q.fields as FieldInfo[]).find((x) => x.name === fname);
      if (!f) {
        console.log(`field ${fname} NOT FOUND on HeroStatsQuery`);
        continue;
      }
      for (const a of f.args) {
        const nt = namedType(a.type);
        if (nt.kind === 'ENUM') await introspectType(tok, nt.name!);
      }
      await selectionFor(tok, namedType(f.type).name!);
      console.log(`${fname}(${f.args.map((a) => `${a.name}: ${typeString(a.type)}`).join(', ')}) → ${typeString(f.type)}`);
    }
    console.log(`introspection calls: ${stratzCalls}; cached in artifacts/lab/stratz/schema/`);
    return;
  }
  const plans = FIELDS[TABLE].map((f) => argPlan(fieldInfo(f), f, ids.length));
  const weekTag = WEEK ? `w${WEEK}` : 'current';
  if (DRY) {
    console.log('DRY RUN — no network calls.');
    console.log(JSON.stringify({ table: TABLE, week: WEEK ?? '(current)', schemaCached: !!hsq, tokenPresent: tok !== null, gapMs: GAP_MS, plans, totalCalls: plans.reduce((s, p) => s + p.calls, 0), estMinutes: +((plans.reduce((s, p) => s + p.calls, 0) * GAP_MS) / 60000).toFixed(1), out: `artifacts/lab/stratz/${TABLE}/${weekTag}/<field>/<key>.json` }, null, 2));
    if (!hsq) console.log('Schema not cached yet: counts are the per-hero upper bound. Run LAB_STRATZ_INTROSPECT=1 first for exact counts.');
    return;
  }
  if (!tok) throw new Error('STRATZ_API_TOKEN not found');
  if (!hsq) throw new Error('run LAB_STRATZ_INTROSPECT=1 first');
  const t0 = Date.now();
  let made = 0;
  for (const p of plans) {
    const f = fieldInfo(p.field)!;
    const groupArg = f.args.find((a) => /^groupBy$/i.test(a.name));
    const groupVals = groupArg ? (cachedSchema<any>(`type-${namedType(groupArg.type).name}.json`)?.enumValues ?? []).map((v: { name: string }) => v.name) : [];
    const sel = await selectionFor(null, namedType(f.type).name!);
    if (!sel) throw new Error(`no selectable fields for ${p.field}`);
    const heroesLoop: (number | undefined)[] = p.heroLoop ? ids : [undefined];
    const posLoop: (string | undefined)[] = p.posLoop ? POSITIONS : [undefined];
    const iwLoop: (boolean | undefined)[] = p.isWithLoop ? [true, false] : [undefined];
    for (const bracket of BRACKETS)
      for (const heroId of heroesLoop)
        for (const pos of posLoop)
          for (const isWith of iwLoop) {
            const key = [bracket, heroId ?? 'all', pos ?? 'allpos', isWith === undefined ? '' : isWith ? 'with' : 'vs'].filter(Boolean).join('-');
            const file = path.join(STRATZ_ROOT, TABLE, weekTag, p.field, `${key}.json`);
            if (fs.existsSync(file)) continue;
            const vars: Record<string, unknown> = {};
            const defs: string[] = [];
            const uses: string[] = [];
            for (const a of f.args) {
              const v = valueFor(a.name, a.type, { heroId, bracket, pos, isWith }, groupVals);
              if (v === undefined) {
                if (a.type.kind === 'NON_NULL') throw new Error(`required arg ${a.name} has no value`);
                continue;
              }
              vars[a.name] = v;
              defs.push(`$${a.name}: ${typeString(a.type)}`);
              uses.push(`${a.name}: $${a.name}`);
            }
            const query = `query Q(${defs.join(', ')}) { heroStats { ${p.field}(${uses.join(', ')}) { ${sel} } } }`;
            const data = await stratzPost(tok, { query, variables: vars });
            made++;
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, JSON.stringify({ field: p.field, vars, week: WEEK ?? null, fetchedAt: new Date().toISOString(), data: data?.heroStats?.[p.field] ?? null }));
            if (made % 25 === 0) console.log(`${made} calls (${p.field} ${key})`);
            await sleep(GAP_MS);
          }
  }
  console.log(`done: ${made} calls in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  appendRun({ kind: 'stratz-table', label: TABLE, config: { fields: FIELDS[TABLE], week: WEEK ?? null, plans }, seed: 0, nMatches: 0, metrics: { calls: made }, wallMs: Date.now() - t0 });
}
main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exitCode = 1;
});
