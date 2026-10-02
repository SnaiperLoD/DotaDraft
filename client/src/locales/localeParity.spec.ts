import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from './en.json';
import ru from './ru.json';

// vitest runs with cwd = client/ (npm workspace), so the repo root is one level up.
const REPO_ROOT = join(process.cwd(), '..');

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = '', out = new Map<string, string>()): Map<string, string> {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else flatten(value, path, out);
  }
  return out;
}

// i18next plural variants (ru needs _few/_many, en only _one/_other): compare by base key.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const baseKeys = (flat: Map<string, string>): Set<string> =>
  new Set([...flat.keys()].map((k) => k.replace(PLURAL_SUFFIX, '')));

const ruFlat = flatten(ru as Tree);
const enFlat = flatten(en as Tree);
const ruBase = baseKeys(ruFlat);
const enBase = baseKeys(enFlat);

/** Keys that are intentionally present in only one locale. Every entry needs a reason. */
const ALLOW_ONE_SIDED: Record<string, string> = {};

/** Server string literals that look like locale keys but are not (service/log names). */
const NOT_LOCALE_KEYS: Record<string, string> = {
  'battle.saveResult': 'Prisma/log operation name in battle.service.ts',
  'battle.recordDraftOutcome': 'Prisma/log operation name in battle.service.ts',
  'eval.axis.narrative':
    'composed client-side from eval.lede.* / eval.body.* (narrative.ts), no own locale string',
};

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort();
}

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) files.push(full);
  }
  return files;
}

/** Locale keys the server emits into Battle story/explanation and Evaluation lines. */
function serverEmittedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const file of walk(join(REPO_ROOT, 'server/src'))) {
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/['"`]((?:battle|eval)\.[A-Za-z0-9_.]*[A-Za-z0-9_])['"`]/g)) {
      keys.add(m[1]);
    }
  }
  // Story beat keys are bare names in the shared union; the client prefixes `battle.story.`.
  const shared = readFileSync(join(REPO_ROOT, 'shared/types/battle.ts'), 'utf8');
  const union = /export type BattleStoryBeatKey =([^;]+);/.exec(shared)?.[1] ?? '';
  for (const m of union.matchAll(/'(\w+)'/g)) keys.add(`battle.story.${m[1]}`);
  for (const key of Object.keys(NOT_LOCALE_KEYS)) keys.delete(key);
  return keys;
}

describe('locale parity', () => {
  it('ru.json and en.json have identical key sets', () => {
    const onlyRu = [...ruBase].filter((k) => !enBase.has(k) && !(k in ALLOW_ONE_SIDED));
    const onlyEn = [...enBase].filter((k) => !ruBase.has(k) && !(k in ALLOW_ONE_SIDED));
    expect({ onlyRu, onlyEn }).toEqual({ onlyRu: [], onlyEn: [] });
  });

  it('interpolation placeholders match per key', () => {
    const mismatched: string[] = [];
    for (const [key, ruText] of ruFlat) {
      const enText = enFlat.get(key);
      if (enText === undefined) continue;
      const a = placeholders(ruText).join(',');
      const b = placeholders(enText).join(',');
      if (a !== b) mismatched.push(`${key}: ru{${a}} en{${b}}`);
    }
    expect(mismatched).toEqual([]);
  });

  it('every locale key the server emits exists in both locales', () => {
    const emitted = serverEmittedKeys();
    expect(emitted.size).toBeGreaterThan(40);
    const missing: string[] = [];
    for (const key of [...emitted].sort()) {
      if (!ruBase.has(key)) missing.push(`ru: ${key}`);
      if (!enBase.has(key)) missing.push(`en: ${key}`);
    }
    expect(missing).toEqual([]);
  });
});
