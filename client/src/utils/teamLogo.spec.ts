import { describe, expect, it } from 'vitest';
import { teamLogoUrl } from './teamLogo';

describe('teamLogoUrl', () => {
  it('resolves Liquipedia slug PNGs for orgs without Steam ids', () => {
    expect(teamLogoUrl('T1')).toBe('/team-logos/t1.png');
    expect(teamLogoUrl('Quincy Crew')).toBe('/team-logos/quincy-crew.png');
    expect(teamLogoUrl('Team Undying')).toBe('/team-logos/undying.png');
  });

  it('returns null for unknown teams so TeamCrest falls back to initials', () => {
    expect(teamLogoUrl('Totally Fake Org')).toBeNull();
  });
});
