import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Hero } from 'shared';
import { api } from '../api/client';
import { heroPortraitUrl } from '../utils/heroIcon';
import { roleTintGradient } from '../utils/heroRoleColor';
import { visibleTagsFor } from '../data/customTags';
import HeroTagBadges from './HeroTagBadges';
import './HeroPool.css';

interface Props {
  pool: Hero[];
  onPick: (heroId: number) => void;
  disabled?: boolean;
  // Names of already-picked heroes — passed to visibleTagsFor so a pool
  // card's revealable tags show as revealed when picking it would
  // complete (or maintain) a synergy already in progress.
  pickedHeroNames?: string[];
  // Ids of the same already-picked heroes, for the live synergy-preview
  // fetch below (visibleTagsFor above works off names, this endpoint off
  // ids — kept as two props rather than deriving one from the other here,
  // since the caller already has both from the same draft.heroes list).
  pickedHeroIds?: number[];
}

// Live golden/red-border synergy highlight (Blueprint/10-tech-debt-backlog.md,
// "Живая подсветка синергичного пика") — per user decision, "top 20%"/
// "bottom 20%" of a 5-hero pool is just the single best/worst candidate,
// not a population-wide percentile (there's no fixed baseline for "real
// synergy delta against THIS partial team" to rank against — the partial
// team is different every round). Recomputed whenever the pool or picked
// roster changes; skipped entirely on round 1 (no picked heroes yet, so the
// server returns all-null and there's nothing to rank).
function useSynergyHighlight(pool: Hero[], pickedHeroIds: number[]) {
  const [scores, setScores] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    let cancelled = false;
    // Both branches resolve through the same .then() — round 1 (no picked
    // heroes yet) just resolves to "no scores" via the same async path,
    // rather than a synchronous setState in the effect body.
    const pending =
      pickedHeroIds.length === 0 || pool.length === 0
        ? Promise.resolve<{ heroId: number; score: number | null }[]>([])
        : api.getSynergyPreview(
            pickedHeroIds,
            pool.map((h) => h.id),
          );

    void pending.then((entries) => {
      if (cancelled) return;
      const next = new Map<number, number>();
      for (const e of entries) {
        if (e.score !== null) next.set(e.heroId, e.score);
      }
      setScores(next);
    });

    return () => {
      cancelled = true;
    };
    // pickedHeroIds/pool are new array instances each render from the
    // parent's draft state, so compare by content, not identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(pickedHeroIds), pool.map((h) => h.id).join(',')]);

  let bestId: number | null = null;
  let worstId: number | null = null;
  for (const [heroId, score] of scores) {
    if (bestId === null || score > scores.get(bestId)!) bestId = heroId;
    if (worstId === null || score < scores.get(worstId)!) worstId = heroId;
  }
  // A 2-candidate pool where both scores tie would make best === worst —
  // not meaningfully "best AND worst", so suppress both rather than
  // highlighting the same card two contradictory ways.
  if (bestId !== null && bestId === worstId) {
    bestId = null;
    worstId = null;
  }
  return { bestId, worstId };
}

// Dota's primary-attribute letter, colored per attribute. The card
// previously carried no attribute at all — it's the one hero fact players
// read before anything else, and it costs a 20px corner.
const ATTR_LETTER: Record<string, string> = { str: 'S', agi: 'A', int: 'I', all: 'U' };

// Pointer-tracked sheen. Writes the cursor position onto the card as CSS
// custom properties and lets HeroPool.css draw the highlight from them —
// deliberately not React state, so sweeping the mouse across the grid
// doesn't re-render five cards on every mousemove frame.
function trackPointer(e: React.MouseEvent<HTMLButtonElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--px', `${((e.clientX - r.left) / r.width) * 100}%`);
  el.style.setProperty('--py', `${((e.clientY - r.top) / r.height) * 100}%`);
}

export default function HeroPool({
  pool,
  onPick,
  disabled,
  pickedHeroNames = [],
  pickedHeroIds = [],
}: Props) {
  const { t } = useTranslation();
  const { bestId, worstId } = useSynergyHighlight(pool, pickedHeroIds);

  // Which card the player just committed to, so it can hold a bright
  // "committing" state through the brief window between the click and the
  // next pool arriving — instead of all five dimming identically the moment
  // `disabled` goes true. Purely visual: it doesn't gate onPick and adds no
  // latency (the pool still swaps whenever the pick resolves; this only
  // fills that gap).
  const [pickingId, setPickingId] = useState<number | null>(null);
  // pickingId only means something while that hero is still in the pool — the
  // loading window. Once the pool advances the picked hero is gone from it,
  // so deriving the committing id from the current pool clears the state on
  // its own: no reset effect, and the "others dimmed" branch can never dim a
  // fresh, unpicked pool.
  const committingId = pickingId !== null && pool.some((h) => h.id === pickingId) ? pickingId : null;

  return (
    <div className="hero-grid">
      {pool.map((hero) => {
        const isBest = hero.id === bestId;
        const isWorst = hero.id === worstId;
        const isCommitting = hero.id === committingId;
        const isFading = committingId !== null && !isCommitting;
        return (
          <button
            key={hero.id}
            className={`hero-card hero-card--attr-${hero.primary_attribute}${
              isBest ? ' hero-card--synergy-best' : ''
            }${isWorst ? ' hero-card--synergy-worst' : ''}${
              isCommitting ? ' hero-card--committing' : ''
            }${isFading ? ' hero-card--fading' : ''}`}
            onClick={() => {
              setPickingId(hero.id);
              onPick(hero.id);
            }}
            onMouseMove={trackPointer}
            disabled={disabled}
          >
            <div className="portrait">
              <img src={heroPortraitUrl(hero.id)} alt={hero.name} width={220} height={137} />
              <div className="role-tint" style={{ background: roleTintGradient(hero) }} />
              <span
                className={`hero-attr hero-attr--${hero.primary_attribute}`}
                title={hero.primary_attribute}
              >
                {ATTR_LETTER[hero.primary_attribute] ?? '?'}
              </span>
              <HeroTagBadges tags={visibleTagsFor(hero.name, [...pickedHeroNames, hero.name])} />

              {/* The border color already flagged these two cards, but only
                  the Legend explained what the color meant. The label says
                  it on the card itself. */}
              {(isBest || isWorst) && (
                <span className={`hero-synergy-flag hero-synergy-flag--${isBest ? 'best' : 'worst'}`}>
                  {t(isBest ? 'draft.synergyBest' : 'draft.synergyWorst')}
                </span>
              )}

              <div className="portrait-shade">
                <div className="hero-name">{hero.name}</div>
              </div>

              {/* Hover/focus affordance — the whole card was already a
                  button, but nothing on it said so until the cursor
                  changed. */}
              <span className="hero-pick-cue" aria-hidden="true">
                {t('draft.pick')}
              </span>
            </div>
            <div className="card-body">
              {hero.roles.slice(0, 3).map((role) => (
                <span key={role} className="pill">
                  {role}
                </span>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}
