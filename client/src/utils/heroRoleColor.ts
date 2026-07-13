import type { Hero, PresumedPosition } from 'shared';

export type PresumedRole = PresumedPosition | 'Universal';

const ROLE_TINT_RGB: Record<PresumedRole, string> = {
  Carry: '150, 35, 55', // crimson
  Offlane: '38, 130, 125', // turquoise
  Mid: '45, 82, 130', // blue
  Support: '107, 175, 107', // light green
  Universal: '196, 130, 45', // sunny orange
};

// +~8% brightness over the original 0.55/0.2 alphas, per user request.
const HIGH_ALPHA = 0.6;
const LOW_ALPHA = 0.22;

// Fallback for heroes with no significant (>=25%) sampled position from
// OpenDota (e.g. brand-new heroes with too few recorded matches) — falls
// back to the old tag-based guess rather than showing no color at all.
// Kept only for that thin-data case; real drafts should mostly use
// hero.presumed_positions. See Blueprint/10-tech-debt-backlog.md.
function classifyPresumedRoleFallback(hero: Hero): PresumedRole {
  const hasCarry = hero.roles.includes('Carry');
  const hasSupport = hero.roles.includes('Support');
  const hasOfflaneSignal = hero.roles.includes('Initiator') || hero.roles.includes('Durable');

  if ((hasCarry && hasSupport) || (hasCarry && hasOfflaneSignal)) return 'Universal';
  if (hasCarry) return 'Carry';
  if (hasSupport) return 'Support';
  if (hasOfflaneSignal) return 'Offlane';
  return 'Mid';
}

function soloGradient(role: PresumedRole): string {
  const rgb = ROLE_TINT_RGB[role];
  return `linear-gradient(135deg, rgba(${rgb}, ${HIGH_ALPHA}) 0%, rgba(${rgb}, ${LOW_ALPHA}) 45%, rgba(${rgb}, 0) 75%)`;
}

function splitGradient(roleA: PresumedRole, roleB: PresumedRole): string {
  const rgbA = ROLE_TINT_RGB[roleA];
  const rgbB = ROLE_TINT_RGB[roleB];
  return [
    'linear-gradient(135deg,',
    `rgba(${rgbA}, ${HIGH_ALPHA}) 0%,`,
    `rgba(${rgbA}, ${LOW_ALPHA}) 35%,`,
    'rgba(0, 0, 0, 0) 50%,',
    `rgba(${rgbB}, ${LOW_ALPHA}) 65%,`,
    `rgba(${rgbB}, ${HIGH_ALPHA}) 100%)`,
  ].join(' ');
}

// 1 significant position -> solid tint. 2 -> split diagonal (A top-left,
// B bottom-right, blending to transparent at the center). 3+ -> Universal.
// No data at all -> fall back to the tag-based guess.
export function roleTintGradient(hero: Hero): string {
  const positions = hero.presumed_positions;

  if (!positions || positions.length === 0) {
    return soloGradient(classifyPresumedRoleFallback(hero));
  }
  if (positions.length === 1) {
    return soloGradient(positions[0].position);
  }
  if (positions.length === 2) {
    return splitGradient(positions[0].position, positions[1].position);
  }
  return soloGradient('Universal');
}
