import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ABILITY_CATEGORY_FOR_AXIS, isAbilityTaggedAxis } from 'shared';
import type { AnalyzerResult, TopAbility } from 'shared';
import type { DraftHeroView } from '../api/types';
import { api } from '../api/client';
import { heroPortraitUrl } from '../utils/heroIcon';
import './TopContributorHighlight.css';

interface Props {
  breakdown: AnalyzerResult[];
  heroes: DraftHeroView[];
}

// Blueprint/10-tech-debt-backlog.md, "Хайлайт топ-контрибьюторов по оси" —
// of the 4 axes with per-ability tagged data (control/mobility/saving/
// initiating, see shared/constants/ability-categories.ts), picks whichever
// ranks highest by percentile in THIS draft and shows its single top
// contributor hero plus that hero's own highest-scoring abilities for the
// matching category. Not claimed to be the draft's overall #1 strength
// (that ranking spans all 16 breakdown items, most of which have no
// ability-level data to drill into) — framed as "top contributor" for a
// specific mechanical axis, not "your best axis overall".
function pickCandidate(breakdown: AnalyzerResult[]) {
  let best: { item: AnalyzerResult; heroId: number } | null = null;
  for (const item of breakdown) {
    if (!isAbilityTaggedAxis(item.key) || !item.topContributorHeroId) continue;
    if (!best || (item.percentile ?? 0) > (best.item.percentile ?? 0)) {
      best = { item, heroId: item.topContributorHeroId };
    }
  }
  return best;
}

export default function TopContributorHighlight({ breakdown, heroes }: Props) {
  const { t } = useTranslation();
  const [abilities, setAbilities] = useState<TopAbility[]>([]);

  const candidate = pickCandidate(breakdown);
  const hero = candidate ? heroes.find((h) => h.heroId === candidate.heroId)?.hero : undefined;

  useEffect(() => {
    // breakdown/heroes only change once per Evaluate Draft click (see
    // EvaluationPanel — result is set once, not refetched), so this effect
    // never needs to walk a candidate back to null after having fetched
    // for one; no state-reset branch needed.
    if (!candidate || !hero) return;
    const category = ABILITY_CATEGORY_FOR_AXIS[candidate.item.key as keyof typeof ABILITY_CATEGORY_FOR_AXIS];
    let cancelled = false;
    void api.getTopAbilities(candidate.heroId, category, 3).then((result) => {
      if (!cancelled) setAbilities(result);
    });
    return () => {
      cancelled = true;
    };
    // candidate/hero are freshly derived every render from breakdown/heroes
    // props — compare by the actual identifying values, not object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.heroId, candidate?.item.key]);

  if (!candidate || !hero || abilities.length === 0) return null;

  return (
    <div className="top-contributor panel">
      <div className="top-contributor-heading">
        {t('evaluation.topContributorHeading', { axis: candidate.item.label })}
      </div>
      <div className="top-contributor-body">
        <div className="top-contributor-hero">
          <img src={heroPortraitUrl(hero.id)} alt={hero.name} width={96} height={60} />
          <span className="top-contributor-hero-name">{hero.name}</span>
        </div>
        <div className="top-contributor-abilities">
          {abilities.map((a) => (
            <div key={a.abilityKey} className="top-contributor-ability">
              <img src={a.iconUrl} alt={a.abilityName} width={48} height={36} />
              <span>{a.abilityName}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
