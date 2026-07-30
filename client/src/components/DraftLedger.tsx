import { useTranslation } from 'react-i18next';
import type { DraftHeroView } from '../api/types';
import { heroIconUrl } from '../utils/heroIcon';
import { visibleTagsFor } from '../data/customTags';
import HeroTagBadges from './HeroTagBadges';
import RoleTooltip from './RoleTooltip';
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

export default function DraftLedger({ heroes, totalSlots, title }: Props) {
  const { t } = useTranslation();
  const sorted = heroes.slice().sort((a, b) => a.pickOrder - b.pickOrder);
  const slots = Array.from({ length: totalSlots }, (_, i) => sorted[i] ?? null);
  const pickedHeroNames = sorted.map((h) => h.hero.name);

  return (
    <div className="panel ledger">
      <h2 className="ledger-title">{title ?? t('draftLedger.defaultTitle')}</h2>
      <p className="ledger-sub">{t('draftLedger.picked', { picked: sorted.length, total: totalSlots })}</p>
      <ol className="ledger-list">
        {slots.map((h, i) => (
          <li key={h?.heroId ?? `empty-${i}`} className={`ledger-slot ${h ? 'filled' : 'empty'}`}>
            <span className="slot-index">#{i + 1}</span>
            {h ? (
              <>
                <RoleTooltip hero={h.hero}>
                  <img
                    src={heroIconUrl(h.heroId)}
                    alt={h.hero.name}
                    width={34}
                    height={34}
                    className="slot-portrait"
                    tabIndex={0}
                  />
                </RoleTooltip>
                <span className="slot-text">
                  <span className="slot-name">{h.hero.name}</span>
                  <span className="slot-role">
                    {h.assignedRole ? t(`roles.${h.assignedRole}`) : t('draftLedger.rolePending')}
                  </span>
                </span>
                <HeroTagBadges tags={visibleTagsFor(h.hero.name, pickedHeroNames)} variant="inline" />
              </>
            ) : (
              <>
                <span className="slot-portrait placeholder" aria-hidden="true" />
                <span className="slot-text">
                  <span className="slot-name placeholder">{t('draftLedger.emptySlot')}</span>
                </span>
              </>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
