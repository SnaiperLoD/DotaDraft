import { useTranslation } from 'react-i18next';
import type { CustomTag } from '../data/customTags';
import { customTagDescription, customTagName } from '../i18n/display';
import './HeroTagBadges.css';

interface Props {
  tags: CustomTag[];
  variant?: 'overlay' | 'inline';
  /** Roster used for count-aware tooltip copy (picked team ± pool hover). */
  contextHeroNames?: string[];
}

export default function HeroTagBadges({ tags, variant = 'overlay', contextHeroNames }: Props) {
  const { t } = useTranslation();
  if (tags.length === 0) return null;

  return (
    <div className={`hero-tag-row hero-tag-row--${variant}`}>
      {tags.map((tag) => (
        <span
          key={tag.name}
          className={`hero-tag-badge rarity-${tag.rarity}`}
          title={customTagDescription(t, tag, { teamHeroNames: contextHeroNames })}
          data-testid="hero-tag-badge"
          data-tag={tag.name}
        >
          {customTagName(t, tag.name)}
        </span>
      ))}
    </div>
  );
}
