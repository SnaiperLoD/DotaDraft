// Display-layer cleanup for OpenDota player names stored on pro pool rows.
// Fetch scripts historically preferred Steam `personaname` over the verified
// `name`, so TI portraits show graffiti like "road to dream (9k)". Without a
// refetch we cannot recover official handles — hide the garbage instead of
// showing it. Next fetch prefers `name` (see fetch-pro-matches-ti.ts).

const GRAFFITI = /\(\d+\s*k\)|road to|going to be|don't |dont |waste|мусор|выводы|terase mugen/i;

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

export function opponentTeamCaption(
  teamName: string | null | undefined,
  leagueName: string | null | undefined,
): { teamName: string | null; leagueName: string | null } {
  const team = teamName?.trim() || null;
  const league = leagueName?.trim() || null;
  if (team) return { teamName: team, leagueName: league };
  return { teamName: league, leagueName: null };
}
