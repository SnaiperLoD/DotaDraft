import type { ActiveBadge } from '../data/badges';
import './BadgeRow.css';

// Hand-drawn (not sourced) line icons — kept simple/geometric to read at
// small size and to match the page's line-art weight rather than importing
// an icon library for 5 glyphs.
const BADGE_ICONS: Record<string, JSX.Element> = {
  chainLock: (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.5">
      <ellipse cx="15" cy="16" rx="8" ry="6" transform="rotate(-30 15 16)" />
      <ellipse cx="25" cy="24" rx="8" ry="6" transform="rotate(-30 25 24)" />
    </svg>
  ),
  ironWall: (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round">
      <path d="M20 4 L34 9 V19 C34 28 28 34 20 37 C12 34 6 28 6 19 V9 Z" />
      <path d="M20 4 V37" strokeWidth="1.5" opacity="0.6" />
    </svg>
  ),
  tempoStorm: (
    <svg viewBox="0 0 40 40" fill="currentColor">
      <path d="M22 3 L10 22 H18 L15 37 L31 16 H21 Z" />
    </svg>
  ),
  oneTrueKing: (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round">
      <path d="M6 30 L8 15 L16 22 L20 10 L24 22 L32 15 L34 30 Z" />
      <path d="M6 30 H34" />
    </svg>
  ),
  visionWeb: (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M4 20 C10 10 30 10 36 20 C30 30 10 30 4 20 Z" strokeLinejoin="round" />
      <circle cx="20" cy="20" r="5" fill="currentColor" stroke="none" />
    </svg>
  ),
};

interface Props {
  badges: ActiveBadge[];
}

// Square icon-only badges for the Evaluation screen — distinct from
// HeroTagBadges (rectangular, text-labeled, shown during drafting). No text
// visible by default per spec; the full description (and which/how many
// heroes triggered it) only shows on hover via the native title tooltip.
export default function BadgeRow({ badges }: Props) {
  if (badges.length === 0) return null;

  return (
    <div className="badge-row">
      {badges.map((badge) => (
        <div key={badge.id} className="badge-square" title={`${badge.name} — ${badge.description}`}>
          <span className="badge-icon">{BADGE_ICONS[badge.id]}</span>
        </div>
      ))}
    </div>
  );
}
