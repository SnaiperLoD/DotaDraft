import { useEffect, useState } from 'react';
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
        : api.getSynergyPreview(pickedHeroIds, pool.map((h) => h.id));

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

export default function HeroPool({ pool, onPick, disabled, pickedHeroNames = [], pickedHeroIds = [] }: Props) {
  const { bestId, worstId } = useSynergyHighlight(pool, pickedHeroIds);

  return (
    <div className="hero-grid">
      {pool.map((hero) => (
        <button
          key={hero.id}
          className={`hero-card ${hero.id === bestId ? 'hero-card--synergy-best' : ''} ${
            hero.id === worstId ? 'hero-card--synergy-worst' : ''
          }`}
          onClick={() => onPick(hero.id)}
          disabled={disabled}
        >
          <div className="portrait">
            <img src={heroPortraitUrl(hero.id)} alt={hero.name} width={220} height={137} />
            <div className="role-tint" style={{ background: roleTintGradient(hero) }} />
            <HeroTagBadges tags={visibleTagsFor(hero.name, [...pickedHeroNames, hero.name])} />
            <div className="portrait-shade">
              <div className="hero-name">{hero.name}</div>
            </div>
          </div>
          <div className="card-body">
            {hero.roles.slice(0, 3).map((role) => (
              <span key={role} className="pill">
                {role}
              </span>
            ))}
          </div>
        </button>
      ))}
    </div>
  );
}
