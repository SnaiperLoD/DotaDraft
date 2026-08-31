import { TEAM_LOGO_BY_NAME } from '../data/teamLogoMap';

function norm(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function compact(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function teamLogoUrl(name: string | null | undefined): string | null {
  if (!name?.trim()) return null;
  return TEAM_LOGO_BY_NAME[norm(name)] ?? TEAM_LOGO_BY_NAME[compact(name)] ?? null;
}
