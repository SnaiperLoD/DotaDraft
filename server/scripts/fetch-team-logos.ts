import * as fs from 'fs';
import * as path from 'path';
import { TI_BRACKETS, teamInitials } from 'shared';

// Scoped logo fetch only: OpenDota /teams metadata + Steam CDN PNGs.
// Does NOT refetch matches, hero meta, or calibration.

const PRO_MATCHES = path.join(__dirname, '..', 'data', 'pro-matches.json');
const OUT_DIR = path.join(__dirname, '..', '..', 'client', 'public', 'team-logos');
const MAP_PATH = path.join(__dirname, '..', '..', 'client', 'src', 'data', 'teamLogoMap.ts');
const STEAM_CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/team_logos';
const STEAM_CDN_ALT = 'https://steamcdn-a.akamaihd.net/apps/dota2/images/team_logos';

// Known Steam team_id overrides when OpenDota name collision / dead logo_url
// would map a TI playoff org onto the wrong file (or none).
const ID_OVERRIDES: Record<string, number> = {
  fnatic: 350190,
  'team undying': 8254145,
  und: 8254145,
  undying: 8254145,
  entity: 8605863,
  t1: 7390454,
  'team aster': 6209804,
  aster: 6209804,
  'quincy crew': 7391077,
  qc: 7391077,
  'betboom team': 8255888,
  betboom: 8255888,
  'bb team': 8255888,
  bb: 8255888,
  'nigma galaxy': 7554697,
  nigma: 7554697,
  ngx: 7554697,
  cloud9: 3,
  c9: 3,
  'psg.lgd': 15,
  'lgd gaming': 15,
  lgd: 15,
  'xtreme gaming': 7119077,
  xg: 7119077,
  'gaimin gladiators': 8599101,
  gg: 8599101,
  'team secret': 1838315,
  secret: 1838315,
  og: 2586976,
  heroic: 9303484,
  'team spirit': 7119388,
  'team liquid': 2163,
  'team falcons': 9247354,
  'tundra esports': 8291895,
  tundra: 8291895,
  parivision: 9572001,
  pvision: 9572001,
  'team vision': 9572001,
  'team tidebound': 9640842,
};

const SKIP_NAMES = new Set(['boomboys', 'boom boys', 'gggggggg', 'team dire']);

type OpenDotaTeam = {
  team_id: number;
  name: string | null;
  tag: string | null;
  logo_url: string | null;
};

type ProMatch = { radiantName: string | null; direName: string | null };

function norm(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function compact(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function aliasMap(): Map<string, string> {
  const map = new Map<string, string>();
  const add = (from: string, to: string) => {
    map.set(norm(from), to);
    map.set(compact(from), to);
  };
  for (const bracket of TI_BRACKETS) {
    for (const match of bracket.matches) {
      add(match.teamA, match.teamA);
      add(match.teamB, match.teamB);
    }
    for (const [canonical, others] of Object.entries(bracket.aliases)) {
      add(canonical, canonical);
      for (const alias of others) add(alias, canonical);
    }
  }
  const extra: [string, string][] = [
    ['PARIVISION', 'TEAM VISION'],
    ['PVISION', 'TEAM VISION'],
    ['PV', 'TEAM VISION'],
    ['1win', 'Iron Wing'],
    ['1w', 'Iron Wing'],
    ['1win Team', 'Iron Wing'],
    ['BB Team', 'BetBoom Team'],
    ['BetBoom', 'BetBoom Team'],
    ['Heroic', 'HEROIC'],
    ['nouns', 'Nouns Esports'],
    ['LGD', 'LGD Gaming'],
    ['LGD Gaming', 'PSG.LGD'],
    ['PSG.LGD', 'LGD Gaming'],
  ];
  for (const [from, to] of extra) add(from, to);
  return map;
}

function collectWanted(): string[] {
  const names = new Set<string>();
  for (const bracket of TI_BRACKETS) {
    for (const match of bracket.matches) {
      names.add(match.teamA);
      names.add(match.teamB);
    }
    for (const [canonical, others] of Object.entries(bracket.aliases)) {
      names.add(canonical);
      for (const alias of others) names.add(alias);
    }
  }
  if (fs.existsSync(PRO_MATCHES)) {
    const raw = JSON.parse(fs.readFileSync(PRO_MATCHES, 'utf8')) as { matches: ProMatch[] };
    for (const row of raw.matches) {
      if (row.radiantName) names.add(row.radiantName);
      if (row.direName) names.add(row.direName);
    }
  }
  return [...names].filter((n) => n.trim().length > 0);
}

async function fetchTeamsPage(page: number): Promise<OpenDotaTeam[]> {
  const url = `https://api.opendota.com/api/teams${page > 0 ? `?page=${page}` : ''}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'DotaDraft-logo-fetch' } });
  if (!res.ok) throw new Error(`OpenDota /teams page ${page}: ${res.status}`);
  return (await res.json()) as OpenDotaTeam[];
}

async function download(url: string, outPath: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'DotaDraft-logo-fetch' } });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 80) return false;
    fs.writeFileSync(outPath, buf);
    return true;
  } catch {
    return false;
  }
}

function indexTeams(teams: OpenDotaTeam[], aliases: Map<string, string>) {
  const byName = new Map<string, OpenDotaTeam>();
  const remember = (key: string, team: OpenDotaTeam) => {
    if (!key) return;
    if (!byName.has(key)) byName.set(key, team);
  };
  for (const team of teams) {
    if (!team.team_id) continue;
    if (team.name) {
      remember(norm(team.name), team);
      remember(compact(team.name), team);
      const aliased = aliases.get(norm(team.name)) ?? aliases.get(compact(team.name));
      if (aliased) {
        remember(norm(aliased), team);
        remember(compact(aliased), team);
      }
    }
    if (team.tag) {
      remember(norm(team.tag), team);
      remember(compact(team.tag), team);
      const aliased = aliases.get(norm(team.tag)) ?? aliases.get(compact(team.tag));
      if (aliased) {
        remember(norm(aliased), team);
        remember(compact(aliased), team);
      }
    }
  }
  return byName;
}

function resolveTeam(name: string, aliases: Map<string, string>, index: Map<string, OpenDotaTeam>) {
  const keys = [norm(name), compact(name), aliases.get(norm(name)), aliases.get(compact(name))].filter(
    Boolean,
  ) as string[];
  for (const key of keys) {
    const hit = index.get(norm(key)) ?? index.get(compact(key));
    if (hit) return hit;
  }
  return null;
}

async function main() {
  const aliases = aliasMap();
  const wanted = collectWanted();
  console.log(`Wanted team names: ${wanted.length}`);

  const pages: OpenDotaTeam[] = [];
  for (const page of [0, 1, 2]) {
    const chunk = await fetchTeamsPage(page);
    pages.push(...chunk);
    if (chunk.length < 1000) break;
  }
  console.log(`OpenDota teams: ${pages.length}`);
  const index = indexTeams(pages, aliases);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const mapping: Record<string, string> = {};
  let downloaded = 0;
  let skipped = 0;
  let missed = 0;

  const queue = [...wanted];
  const concurrency = 6;
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const name = queue.shift();
      if (!name) return;
      if (SKIP_NAMES.has(norm(name)) || SKIP_NAMES.has(compact(name))) {
        continue;
      }
      const overrideId = ID_OVERRIDES[norm(name)] ?? ID_OVERRIDES[compact(name)];
      const team = overrideId
        ? { team_id: overrideId, name, tag: null, logo_url: `${STEAM_CDN}/${overrideId}.png` }
        : resolveTeam(name, aliases, index);
      if (!team) {
        missed++;
        console.warn(`No OpenDota team for "${name}"`);
        continue;
      }
      const file = `${team.team_id}.png`;
      const outPath = path.join(OUT_DIR, file);
      const rel = `/team-logos/${file}`;
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 80) {
        mapping[norm(name)] = rel;
        mapping[compact(name)] = rel;
        const canonical = aliases.get(norm(name)) ?? aliases.get(compact(name));
        if (canonical) {
          mapping[norm(canonical)] = rel;
          mapping[compact(canonical)] = rel;
        }
        skipped++;
        continue;
      }
      const urls = [
        team.logo_url,
        `${STEAM_CDN}/${team.team_id}.png`,
        `${STEAM_CDN_ALT}/${team.team_id}.png`,
      ].filter((u): u is string => Boolean(u));
      let ok = false;
      for (const url of urls) {
        if (await download(url, outPath)) {
          ok = true;
          downloaded++;
          break;
        }
      }
      if (!ok) {
        missed++;
        console.warn(`Logo download failed for "${name}" (id ${team.team_id})`);
        continue;
      }
      mapping[norm(name)] = rel;
      mapping[compact(name)] = rel;
      const canonical = aliases.get(norm(name)) ?? aliases.get(compact(name));
      if (canonical) {
        mapping[norm(canonical)] = rel;
        mapping[compact(canonical)] = rel;
      }
    }
  });
  await Promise.all(workers);

  const keys = Object.keys(mapping).sort();
  const body = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(mapping[k])},`).join('\n');
  const file = `// Generated by server/scripts/fetch-team-logos.ts — do not edit by hand.
export const TEAM_LOGO_BY_NAME: Record<string, string> = {
${body}
};
`;
  fs.mkdirSync(path.dirname(MAP_PATH), { recursive: true });
  fs.writeFileSync(MAP_PATH, file, 'utf8');
  console.log(
    `Done. Logos downloaded: ${downloaded}, already present: ${skipped}, missed: ${missed}, map keys: ${keys.length}. Initials fallback still used for misses (${teamInitials('?')}).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
