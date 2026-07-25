import type { Hero } from 'shared';
import './RoleTooltip.css';

interface Props {
  hero: Hero;
  children: React.ReactNode;
}

const POSITION_LABEL: Record<string, string> = {
  Carry: 'Carry',
  Mid: 'Mid',
  Offlane: 'Offlane',
  Support: 'Support',
};

// Custom hover tooltip (pure CSS, no JS positioning) showing a picked
// hero's REAL positions — presumed_positions, GPM-rank data from real
// matches (server/data/hero-meta.json) — distinct from assignedRole
// (DraftLedger's already-visible plain-text "Role pending"/role name,
// which is the player's OWN assignment for THIS draft, not the hero's
// real-world tendency). Blueprint/10-tech-debt-backlog.md, "Тултип с
// ролями уже выбранных героев" — the native HTML `title` this replaces
// only ever showed the hero's name, and only DraftLedger's predecessor
// (PickedHeroesStrip) had that; DraftLedger doesn't set a `title` at all,
// so this is new information, not a native->custom tooltip swap.
export default function RoleTooltip({ hero, children }: Props) {
  const positions = hero.presumed_positions;

  return (
    <span className="role-tooltip">
      {children}
      <span className="role-tooltip-panel" role="tooltip">
        <span className="role-tooltip-name">{hero.name}</span>
        {positions.length > 0 ? (
          <span className="role-tooltip-positions">
            {positions.map((p) => (
              <span key={p.position} className="role-tooltip-position">
                {POSITION_LABEL[p.position] ?? p.position}
                <span className="role-tooltip-share">{Math.round(p.share * 100)}%</span>
              </span>
            ))}
          </span>
        ) : (
          <span className="role-tooltip-positions role-tooltip-empty">No strong real-position data</span>
        )}
      </span>
    </span>
  );
}
