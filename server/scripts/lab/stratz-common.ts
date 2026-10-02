// STRATZ helpers for the Variance Lab. Token: STRATZ_API_TOKEN from env or
// <repo>/.env — never printed, logged or persisted; errors are sanitised.
import * as fs from 'fs';
import * as path from 'path';
import { REPO_ROOT } from './lab-common';

export const STRATZ_URL = 'https://api.stratz.com/graphql';
export const STRATZ_ROOT = path.join(REPO_ROOT, 'artifacts', 'lab', 'stratz');
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function stratzToken(): string | null {
  if (process.env.STRATZ_API_TOKEN) return process.env.STRATZ_API_TOKEN;
  const envPath = path.join(REPO_ROOT, '.env');
  if (!fs.existsSync(envPath)) return null;
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*STRATZ_API_TOKEN\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^['"]|['"]$/g, '') || null;
  }
  return null;
}

export let stratzCalls = 0;
export async function stratzPost(tok: string, body: unknown): Promise<any> {
  for (let attempt = 0; attempt < 6; attempt++) {
    let res: Response;
    try {
      stratzCalls++;
      res = await fetch(STRATZ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'User-Agent': 'STRATZ_API', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      console.log('  network error, retry in 20s');
      await sleep(20000);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      const wait = Math.min(300000, 10000 * 2 ** attempt);
      console.log(`  HTTP ${res.status}, backoff ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors?.length) throw new Error(`GraphQL error: ${String(json.errors[0]?.message ?? 'unknown').slice(0, 300)}`);
    return json.data;
  }
  throw new Error('gave up after backoff');
}

// ---------- introspection (cached under artifacts/lab/stratz/schema/) ----------
export interface TypeRef {
  kind: string;
  name: string | null;
  ofType?: TypeRef | null;
}
export interface FieldInfo {
  name: string;
  description: string | null;
  args: { name: string; description: string | null; type: TypeRef }[];
  type: TypeRef;
}
const TYPE_REF = 'kind name ofType { kind name ofType { kind name ofType { kind name } } }';
const SCHEMA_DIR = path.join(STRATZ_ROOT, 'schema');

export function typeString(t: TypeRef): string {
  if (t.kind === 'NON_NULL') return `${typeString(t.ofType!)}!`;
  if (t.kind === 'LIST') return `[${typeString(t.ofType!)}]`;
  return t.name!;
}
export function namedType(t: TypeRef): TypeRef {
  return t.ofType ? namedType(t.ofType) : t;
}
export function cachedSchema<T>(file: string): T | null {
  const p = path.join(SCHEMA_DIR, file);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf-8')) as T) : null;
}
export async function introspectType(tok: string, name: string): Promise<{ kind: string; fields: FieldInfo[] | null; enumValues: { name: string }[] | null; inputFields: unknown }> {
  const file = `type-${name}.json`;
  const c = cachedSchema<any>(file);
  if (c) return c;
  const data = await stratzPost(tok, {
    query: `{ __type(name: "${name}") { kind fields { name description args { name description type { ${TYPE_REF} } } type { ${TYPE_REF} } } enumValues { name } inputFields { name type { ${TYPE_REF} } } } }`,
  });
  fs.mkdirSync(SCHEMA_DIR, { recursive: true });
  fs.writeFileSync(path.join(SCHEMA_DIR, file), JSON.stringify(data.__type, null, 2));
  return data.__type;
}

/** Selection set: scalars/enums of the return type, plus one nested object level (scalars only). */
export async function selectionFor(tok: string | null, typeName: string, depth = 0): Promise<string> {
  const t = tok ? await introspectType(tok, typeName) : cachedSchema<any>(`type-${typeName}.json`);
  if (!t?.fields) return '';
  const parts: string[] = [];
  for (const f of t.fields as FieldInfo[]) {
    if (f.args?.some((a) => a.type.kind === 'NON_NULL')) continue;
    const nt = namedType(f.type);
    if (nt.kind === 'SCALAR' || nt.kind === 'ENUM') parts.push(f.name);
    else if (nt.kind === 'OBJECT' && depth < 1) {
      const sub = await selectionFor(tok, nt.name!, depth + 1);
      if (sub) parts.push(`${f.name} { ${sub} }`);
    }
  }
  return parts.join(' ');
}
