import type { DraftHeroView } from '../api/types';
import { heroIconUrl } from '../utils/heroIcon';
import './DraftLedger.css';

// Persistent record of the 5 pick slots — replaces the old fixed-bottom
// PickedHeroesStrip and, in its read-only form, DraftSummary. One
// component covers picking (roles not yet known), role assignment
// (heroes locked, roles pending), and the completed team view, since it's
// the same information at every stage.
interface Props {
  heroes: DraftHeroView[];
  totalSlots: number;
  title?: string;
}

export default function DraftLedger({ heroes, totalSlots, title = 'Your Draft' }: Props) {
  const sorted = heroes.slice().sort((a, b) => a.pickOrder - b.pickOrder);
  const slots = Array.from({ length: totalSlots }, (_, i) => sorted[i] ?? null);

  return (
    <div className="panel ledger">
      <h2 className="ledger-title">{title}</h2>
      <p className="ledger-sub">
        {sorted.length} of {totalSlots} picked
      </p>
      <ol className="ledger-list">
        {slots.map((h, i) => (
          <li key={h?.heroId ?? `empty-${i}`} className={`ledger-slot ${h ? 'filled' : 'empty'}`}>
            <span className="slot-index">#{i + 1}</span>
            {h ? (
              <>
                <img
                  src={heroIconUrl(h.heroId)}
                  alt={h.hero.name}
                  width={34}
                  height={34}
                  className="slot-portrait"
                />
                <span className="slot-text">
                  <span className="slot-name">{h.hero.name}</span>
                  <span className="slot-role">{h.assignedRole ?? 'Role pending'}</span>
                </span>
              </>
            ) : (
              <>
                <span className="slot-portrait placeholder" aria-hidden="true" />
                <span className="slot-text">
                  <span className="slot-name placeholder">Empty slot</span>
                </span>
              </>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
