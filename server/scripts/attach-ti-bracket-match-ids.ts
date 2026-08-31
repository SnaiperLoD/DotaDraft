import * as fs from 'fs';
import * as path from 'path';
import { TI_BRACKETS, teamsMatch, type TiBracket } from 'shared';

// Local-only: attach OpenDota match ids already sitting in pro-matches.json
// onto the hand-authored TI bracket nodes. No network.

type ProMatch = {
  matchId: string;
  radiantName: string | null;
  direName: string | null;
  leagueName: string | null;
};

function loadMatches(): ProMatch[] {
  const file = path.join(__dirname, '../data/pro-matches.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { matches: ProMatch[] };
  return raw.matches;
}

function leagueRows(matches: ProMatch[], bracket: TiBracket): ProMatch[] {
  const exact = matches.filter((m) => (m.leagueName ?? '').includes(bracket.leagueName));
  if (exact.length > 0) return exact;
  return matches.filter((m) => (m.leagueName ?? '').includes(`International ${bracket.year}`));
}

function pairMatches(rows: ProMatch[], bracket: TiBracket, teamA: string, teamB: string): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    const radiant = row.radiantName ?? '';
    const dire = row.direName ?? '';
    const aVsB =
      teamsMatch(radiant, teamA, bracket.aliases) && teamsMatch(dire, teamB, bracket.aliases);
    const bVsA =
      teamsMatch(radiant, teamB, bracket.aliases) && teamsMatch(dire, teamA, bracket.aliases);
    if (aVsB || bVsA) ids.push(row.matchId);
  }
  return [...new Set(ids)];
}

function main() {
  const matches = loadMatches();
  const out: Record<string, Record<string, string[]>> = {};
  let attached = 0;
  let empty = 0;
  for (const bracket of TI_BRACKETS) {
    const rows = leagueRows(matches, bracket);
    out[bracket.id] = {};
    for (const node of bracket.matches) {
      const ids = pairMatches(rows, bracket, node.teamA, node.teamB);
      out[bracket.id][node.id] = ids;
      if (ids.length > 0) attached += 1;
      else empty += 1;
    }
  }
  const dest = path.join(__dirname, '../../shared/data/ti-bracket-match-ids.json');
  fs.writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`Wrote ${dest}`);
  console.log(`nodes with matchIds: ${attached}; empty: ${empty}`);
}

main();
