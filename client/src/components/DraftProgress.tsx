import { useTranslation } from 'react-i18next';
import type { DraftHeroView } from '../api/types';
import { heroIconUrl } from '../utils/heroIcon';
import './DraftProgress.css';

interface Props {
  heroes: DraftHeroView[];
  totalSlots: number;
  // 1-5 while picking, null once every slot is filled (role assignment
  // onward) — there's no "current" round to mark at that point.
  currentRound: number | null;
}

// Replaces the flat "Round 3 of 5" line. Same information, but as five
// slots on a rail: filled ones carry the hero's icon, so the header
// doubles as an at-a-glance record of the draft so far and the player
// can see how much is left without counting.
export default function DraftProgress({ heroes, totalSlots, currentRound }: Props) {
  const { t } = useTranslation();
  const sorted = heroes.slice().sort((a, b) => a.pickOrder - b.pickOrder);
  const slots = Array.from({ length: totalSlots }, (_, i) => sorted[i] ?? null);

  return (
    <div className="draft-progress">
      <div className="draft-progress-head">
        <h1>
          {currentRound === null ? (
            t('draft.allPicked')
          ) : (
            <>
              <em>{t('draft.roundNumber', { round: currentRound })}</em> {t('draft.ofFive')}
            </>
          )}
        </h1>
        <span className="draft-progress-count">
          {t('draftLedger.picked', { picked: sorted.length, total: totalSlots })}
        </span>
      </div>

      <ol className="draft-progress-rail">
        {slots.map((hero, i) => {
          const state = hero ? 'filled' : i + 1 === currentRound ? 'current' : 'empty';
          return (
            <li key={hero?.heroId ?? `empty-${i}`} className={`draft-progress-step is-${state}`}>
              <span className="draft-progress-node">
                {hero ? (
                  <img src={heroIconUrl(hero.heroId)} alt={hero.hero.name} width={32} height={32} />
                ) : (
                  <span className="draft-progress-number">{i + 1}</span>
                )}
              </span>
              <span className="draft-progress-label">
                {hero ? hero.hero.name : t('draftLedger.emptySlot')}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
