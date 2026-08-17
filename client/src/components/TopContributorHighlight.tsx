import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ABILITY_CATEGORY_FOR_AXIS, isAbilityTaggedAxis } from 'shared';
import type { AnalyzerResult, TopAbility } from 'shared';
import type { DraftHeroView } from '../api/types';
import { api } from '../api/client';
import { heroPortraitUrl } from '../utils/heroIcon';
import { axisLabel } from '../i18n/display';
import './TopContributorHighlight.css';

interface Props {
  breakdown: AnalyzerResult[];
  heroes: DraftHeroView[];
}

const MAX_CARDS = 3;

// Blueprint/10-tech-debt-backlog.md, "Топ-контрибьютор для каждой сильной
// категории" — by user request, extends the original single-axis highlight
// (kept as-is otherwise: only control/mobility/saving/initiating have
// per-ability tagged data, see shared/constants/ability-categories.ts) to
// cover the draft's top MAX_CARDS breakdown items by percentile, not just
// the single best ability-tagged one. Every axis has a topContributorHeroId
// (axis.analyzer.ts sets it regardless of ability-tagging), so a card still
// renders — with just the hero, no ability icons — for a top category that
// isn't one of the 4 ability-tagged axes. Synergy/Counter/Pro Similarity
// have no topContributorHeroId (not per-hero axis scores) and are
// naturally excluded by the filter below, not a special case.
function pickCandidates(breakdown: AnalyzerResult[]) {
  return [...breakdown]
    .filter((item) => item.topContributorHeroId != null && item.percentile !== null)
    .sort((a, b) => (b.percentile ?? 0) - (a.percentile ?? 0))
    .slice(0, MAX_CARDS);
}

function ContributorCard({ item, heroes }: { item: AnalyzerResult; heroes: DraftHeroView[] }) {
  const { t } = useTranslation();
  const [abilities, setAbilities] = useState<TopAbility[]>([]);
  const hero = heroes.find((h) => h.heroId === item.topContributorHeroId)?.hero;
  const taggedAxis = isAbilityTaggedAxis(item.key);

  useEffect(() => {
    if (!hero || !taggedAxis) return;
    const category = ABILITY_CATEGORY_FOR_AXIS[item.key as keyof typeof ABILITY_CATEGORY_FOR_AXIS];
    let cancelled = false;
    void api.getTopAbilities(hero.id, category, 3).then((result) => {
      if (!cancelled) setAbilities(result);
    });
    return () => {
      cancelled = true;
    };
    // hero.id/item.key are the actual identifying values for this effect —
    // compare by those, not object identity (same reasoning as the
    // original single-card version this replaces).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hero?.id, item.key, taggedAxis]);

  if (!hero) return null;

  return (
    <div className="top-contributor-card">
      <div className="top-contributor-heading">
        {t('evaluation.topContributorHeading', { axis: axisLabel(t, item.key, item.label) })}
      </div>
      <div className="top-contributor-body">
        <div className="top-contributor-hero">
          <img src={heroPortraitUrl(hero.id)} alt={hero.name} width={96} height={60} />
          <span className="top-contributor-hero-name">{hero.name}</span>
        </div>
        {abilities.length > 0 && (
          <div className="top-contributor-abilities">
            {abilities.map((a) => (
              <div key={a.abilityKey} className="top-contributor-ability">
                <img src={a.iconUrl} alt={a.abilityName} width={48} height={36} />
                <span>{a.abilityName}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TopContributorHighlight({ breakdown, heroes }: Props) {
  const candidates = pickCandidates(breakdown);
  if (candidates.length === 0) return null;

  return (
    <div className="top-contributor panel">
      {candidates.map((item) => (
        <ContributorCard key={item.key} item={item} heroes={heroes} />
      ))}
    </div>
  );
}
