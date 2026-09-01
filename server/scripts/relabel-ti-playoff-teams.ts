import * as fs from 'fs';
import * as path from 'path';
import { TI_BRACKETS, playoffTeams, teamsMatch, type TiBracket } from 'shared';

// OpenDota /matches rewrites historical team names to whatever org currently
// owns the Steam team_id. TI Run attach then cannot find Entity/RNG/T1/etc.
// Relabel by account-id overlap with trusted orgs + a few known seed stacks.

const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'pro-matches.json');
const MIN_OVERLAP = 3;

type Role = { accountId?: number | null };
type Stored = {
  matchId: string;
  radiantName: string | null;
  direName: string | null;
  leagueName: string | null;
  radiantHeroRoles?: Role[];
  direHeroRoles?: Role[];
};

const TRUSTED = new Set([
  'Team Secret',
  'Tundra Esports',
  'Team Liquid',
  'OG',
  'Team Spirit',
  'PSG.LGD',
  'LGD Gaming',
  'Team Aster',
  'Gaimin Gladiators',
  'BOOM Esports',
  'Team Falcons',
  'Nigma Galaxy',
  'TEAM VISION',
  'Team Yandex',
  'Virtus.pro',
  'Vici Gaming',
  'Invictus Gaming',
  'Alliance',
  'Thunder Awaken',
  'BetBoom Team',
  'Talon Esports',
  'Shopify Rebellion',
  'Azure Ray',
  '9Pandas',
  'Cloud9',
  'Xtreme Gaming',
  'PARIVISION',
  'HEROIC',
  'Team Tidebound',
  'BoomBoys',
  'Iron Wing',
  'nouns',
  'Nouns Esports',
]);

const SEED_MATCHES: { matchId: string; radiant: string; dire: string }[] = [
  { matchId: '6814073054', radiant: 'Royal Never Give Up', dire: 'Entity' },
  { matchId: '6813896391', radiant: 'beastcoast', dire: 'Hokori' },
  { matchId: '6813739089', radiant: 'Thunder Awaken', dire: 'Evil Geniuses' },
  { matchId: '6813782414', radiant: 'Thunder Awaken', dire: 'Evil Geniuses' },
  { matchId: '6814001211', radiant: 'Fnatic', dire: 'Gaimin Gladiators' },
  // TI10 playoffs: Steam team_ids now resolve to successor org names.
  { matchId: '6219875084', radiant: 'Fnatic', dire: 'Team Undying' },
  { matchId: '6220007628', radiant: 'Team Aster', dire: 'Quincy Crew' },
  { matchId: '6220239665', radiant: 'Elephant', dire: 'Evil Geniuses' },
  { matchId: '6220692458', radiant: 'PSG.LGD', dire: 'T1' },
  { matchId: '6220754493', radiant: 'PSG.LGD', dire: 'T1' },
  { matchId: '6220816055', radiant: 'PSG.LGD', dire: 'T1' },
  { matchId: '6221203314', radiant: 'Team Spirit', dire: 'Fnatic' },
  { matchId: '6221296920', radiant: 'Fnatic', dire: 'Team Spirit' },
  { matchId: '6221412840', radiant: 'OG', dire: 'Quincy Crew' },
  { matchId: '6221491372', radiant: 'Quincy Crew', dire: 'OG' },
  { matchId: '6222023409', radiant: 'Alliance', dire: 'T1' },
  { matchId: '6222126346', radiant: 'T1', dire: 'Alliance' },
  { matchId: '6223515865', radiant: 'Vici Gaming', dire: 'T1' },
  { matchId: '6223583227', radiant: 'Vici Gaming', dire: 'T1' },
  { matchId: '6223662107', radiant: 'T1', dire: 'Vici Gaming' },
];

function idsFrom(roles: Role[] | undefined): number[] {
  return (roles ?? []).map((r) => r.accountId).filter((id): id is number => typeof id === 'number' && id > 0);
}

function overlap(a: Set<number>, b: number[]): number {
  let n = 0;
  for (const id of b) if (a.has(id)) n += 1;
  return n;
}

function bestTeam(rosters: Map<string, Set<number>>, ids: number[]): { team: string; score: number } | null {
  let team = '';
  let score = 0;
  for (const [name, roster] of rosters) {
    const n = overlap(roster, ids);
    if (n > score) {
      score = n;
      team = name;
    }
  }
  return score >= MIN_OVERLAP ? { team, score } : null;
}

function addRoster(rosters: Map<string, Set<number>>, team: string, ids: number[]) {
  const set = rosters.get(team) ?? new Set<number>();
  for (const id of ids) set.add(id);
  rosters.set(team, set);
}

function canonicalPlayoffName(name: string, bracket: TiBracket): string | null {
  for (const team of playoffTeams(bracket.matches)) {
    if (teamsMatch(name, team, bracket.aliases)) return team;
  }
  return null;
}

function relabelLeague(matches: Stored[], bracket: TiBracket): number {
  const leagueRows = matches.filter((m) => (m.leagueName ?? '').includes(bracket.leagueName));
  const rosters = new Map<string, Set<number>>();

  for (const row of leagueRows) {
    const radiant = canonicalPlayoffName(row.radiantName ?? '', bracket);
    const dire = canonicalPlayoffName(row.direName ?? '', bracket);
    if (radiant && TRUSTED.has(row.radiantName ?? '') && TRUSTED.has(radiant)) {
      addRoster(rosters, radiant, idsFrom(row.radiantHeroRoles));
    }
    if (dire && TRUSTED.has(row.direName ?? '') && TRUSTED.has(dire)) {
      addRoster(rosters, dire, idsFrom(row.direHeroRoles));
    }
  }

  for (const seed of SEED_MATCHES) {
    const row = leagueRows.find((m) => m.matchId === seed.matchId);
    if (!row) continue;
    addRoster(rosters, seed.radiant, idsFrom(row.radiantHeroRoles));
    addRoster(rosters, seed.dire, idsFrom(row.direHeroRoles));
    row.radiantName = seed.radiant;
    row.direName = seed.dire;
  }

  let changed = 0;
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of leagueRows) {
      const radiantIds = idsFrom(row.radiantHeroRoles);
      const direIds = idsFrom(row.direHeroRoles);
      const radiantHit = bestTeam(rosters, radiantIds);
      const direHit = bestTeam(rosters, direIds);
      if (radiantHit && row.radiantName !== radiantHit.team) {
        row.radiantName = radiantHit.team;
        addRoster(rosters, radiantHit.team, radiantIds);
        changed += 1;
        grew = true;
      } else if (radiantHit) {
        addRoster(rosters, radiantHit.team, radiantIds);
      }
      if (direHit && row.direName !== direHit.team) {
        row.direName = direHit.team;
        addRoster(rosters, direHit.team, direIds);
        changed += 1;
        grew = true;
      } else if (direHit) {
        addRoster(rosters, direHit.team, direIds);
      }
    }
  }

  console.log(
    `  ${bracket.id}: ${leagueRows.length} matches, ${rosters.size} rosters, ${changed} side relabels`,
  );
  return changed;
}

function main() {
  const parsed = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8')) as { generatedAt?: string; matches: Stored[] };
  let total = 0;
  for (const bracket of TI_BRACKETS) {
    total += relabelLeague(parsed.matches, bracket);
  }
  parsed.generatedAt = new Date().toISOString();
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(parsed, null, 2)}\n`);
  console.log(`Wrote ${OUTPUT_PATH} (${total} side labels changed)`);
}

main();
