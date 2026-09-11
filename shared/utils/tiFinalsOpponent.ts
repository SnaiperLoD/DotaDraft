// Frozen OpenDota match IDs for The International *grand finals* games
// (every game of the last series of each completed TI in the local
// pro-matches.json snapshot, generatedAt 2026-09-01).
//
// Why a frozen ID set, not leagueName / "last series at runtime":
// OpenDota and our snapshot have no stage flag. `leagueName` containing
// "The International" also covers groups, playoffs, and regional
// qualifiers (see fetch-pro-matches-ti-playoffs.ts). A live "last series
// of this league" walk would label a TI 2026 group series as a final.
//
// How the IDs were chosen: for each completed TI 2012–2026 present in
// the snapshot, take the chronological last series (same two teams at
// the end of the playoff window). Those pairings/dates/lengths match the
// known grand finals (iG–Na'Vi, Alliance–Na'Vi, Newbee–VG, EG–CDEC,
// Wings–DC, Liquid–Newbee, OG–LGD, OG–Liquid, Spirit–LGD, Tundra–Secret,
// Spirit–GG, Liquid–GG, Falcons–XG, Spirit–VISION). OpenDota sometimes rewrites org
// names on old rows (TI5 "GGGGGGGG"/"Shopify Rebellion", TI6 "123"/
// "the wings gaming") — IDs and dates still match the finals.
//
// Not in this set: TI10 (no OpenDota matches), regional qualifiers, and any
// playoff game before the last series. Append new IDs only after a completed
// TI grand finals lands in the snapshot — do not infer from league name.

const TI_FINALS_MATCH_IDS: ReadonlySet<string> = new Set([
  // TI 2012 — Invictus Gaming vs Natus Vincere
  '37623177',
  '37626434',
  '37629117',
  '37633163',
  // TI 2013 — Alliance vs Natus Vincere
  '271076032',
  '271088718',
  '271102834',
  '271123757',
  '271145478',
  // TI 2014 — Newbee vs Vici Gaming
  '789453600',
  '789518247',
  '789590883',
  '789645621',
  // TI 2015 — EG vs CDEC (OpenDota names rewritten)
  '1697618202',
  '1697676707',
  '1697737102',
  '1697818230',
  // TI 2016 — Wings Gaming vs Digital Chaos (OpenDota names rewritten)
  '2569415435',
  '2569470828',
  '2569531910',
  '2569610900',
  // TI 2017 — Team Liquid vs Newbee
  '3372622939',
  '3372676225',
  '3372726385',
  // TI 2018 — OG vs LGD Gaming
  '4080601137',
  '4080666526',
  '4080723031',
  '4080778303',
  '4080856812',
  // TI 2019 — OG vs Team Liquid
  '4986133311',
  '4986260666',
  '4986362254',
  '4986461644',
  // TI 2021 — Team Spirit vs LGD Gaming
  '6227105229',
  '6227203516',
  '6227305557',
  '6227419633',
  '6227492909',
  // TI 2022 — Tundra Esports vs Team Secret
  '6832008209',
  '6832140410',
  '6832287527',
  // TI 2023 — Team Spirit vs Gaimin Gladiators
  '7406424070',
  '7406482053',
  '7406531302',
  // TI 2024 — Team Liquid vs Gaimin Gladiators
  '7944065089',
  '7944174632',
  '7944311818',
  // TI 2025 — Team Falcons vs Xtreme Gaming
  '8461476910',
  '8461613337',
  '8461735141',
  '8461854486',
  '8461956309',
  // TI 2026 — Team Spirit vs TEAM VISION (last series in the snapshot)
  '8960577698',
  '8960655084',
  '8960762254',
  '8960882635',
  '8960991322',
]);

export interface TiFinalsOpponentInput {
  source?: string | null;
  matchId?: string | number | null;
}

export function isTiFinalsOpponent(opponent: TiFinalsOpponentInput | null | undefined): boolean {
  if (!opponent || opponent.source !== 'pro' || opponent.matchId == null || opponent.matchId === '') {
    return false;
  }
  return TI_FINALS_MATCH_IDS.has(String(opponent.matchId));
}
