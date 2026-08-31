// Display-layer cleanup for OpenDota player names stored on pro pool rows.
// Fetch scripts historically preferred Steam `personaname` over the verified
// `name`, so TI portraits show graffiti like "road to dream (9k)". Official
// handles come from OpenDota `/api/proPlayers` keyed by Steam account_id
// (same list Liquipedia feeds into OpenDota — 1:1, not string matching).

const GRAFFITI = /\(\d+\s*k\)|road to|going to be|don't |dont |waste|мусор|выводы|terase mugen/i;

export interface OpenDotaMatchPlayer {
  account_id?: number | null;
  name?: string | null;
  personaname?: string | null;
}

export function sanitizeProPlayerName(name: string | null | undefined): string | null {
  if (name == null) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (trimmed.length > 20) return null;
  if (GRAFFITI.test(trimmed)) return null;
  if (/[\u4E00-\u9FFF\u3040-\u30FF]/.test(trimmed)) return null;
  if ((trimmed.match(/\s+/g) ?? []).length >= 2) return null;
  if (/^[;:.,|/\\~]/.test(trimmed)) return null;
  if (/[~]/.test(trimmed) && trimmed.length <= 3) return null;
  return trimmed;
}

// Battle display: keep curated handles that the Steam-graffiti filter
// rejects only because of CJK (e.g. OpenDota proPlayers "医者watson`").
// Pure CJK sentences stay hidden.
export function displayProPlayerName(name: string | null | undefined): string | null {
  const cleaned = sanitizeProPlayerName(name);
  if (cleaned) return cleaned;
  if (name == null) return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 24 || GRAFFITI.test(trimmed)) return null;
  if ((trimmed.match(/\s+/g) ?? []).length >= 2) return null;
  const hasLatin = /[A-Za-z0-9]/.test(trimmed);
  const hasCjk = /[\u4E00-\u9FFF\u3040-\u30FF]/.test(trimmed);
  if (hasCjk && hasLatin) return trimmed;
  // Short CJK-only official handles (天鸽, 爱, 皮球) — not sentence graffiti.
  if (hasCjk && [...trimmed].length <= 4) return trimmed;
  return null;
}

// Prefer the curated proPlayers handle for this Steam account. Then the
// match's verified `name`. Steam personaname is last and still goes through
// the graffiti filter — that's the field that produced "road to dream (9k)".
export function resolveOfficialPlayerName(
  player: OpenDotaMatchPlayer,
  proNameByAccountId: ReadonlyMap<number, string>,
): string | null {
  const accountId = player.account_id;
  if (typeof accountId === 'number' && accountId > 0) {
    const official = proNameByAccountId.get(accountId)?.trim();
    if (official) return official;
  }
  const verified = player.name?.trim();
  if (verified && !GRAFFITI.test(verified)) return verified;
  return sanitizeProPlayerName(player.personaname);
}

export function opponentTeamCaption(
  teamName: string | null | undefined,
  leagueName: string | null | undefined,
): { teamName: string | null; leagueName: string | null } {
  const team = teamName?.trim() || null;
  const league = leagueName?.trim() || null;
  if (team) return { teamName: team, leagueName: league };
  return { teamName: league, leagueName: null };
}
