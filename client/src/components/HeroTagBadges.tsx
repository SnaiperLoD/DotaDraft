import type { CustomTag } from '../data/customTags';
import './HeroTagBadges.css';

interface Props {
  tags: CustomTag[];
  // 'overlay' (default): absolutely positioned over a portrait — HeroPool's
  // big pick cards. 'inline': flows in normal document layout — DraftLedger's
  // compact picked-hero rows, which have no portrait to overlay.
  variant?: 'overlay' | 'inline';
}

// Small rarity-bordered rectangles — a separate column from the built-in
// hero tags (Initiator/Carry/Disabler/etc, see HeroPool's .pill row) since
// these are hand-authored combo/synergy tags, not derived from
// evaluation_values. Visual reference: eraball.com's player tag chips.
// Renders nothing if the hero has no visible tags — always-hidden and
// not-yet-revealed tags are filtered out by the caller (visibleTagsFor in
// data/customTags.ts), never reaching this component.
export default function HeroTagBadges({ tags, variant = 'overlay' }: Props) {
  if (tags.length === 0) return null;

  return (
    <div className={`hero-tag-row hero-tag-row--${variant}`}>
      {tags.map((tag) => (
        <span
          key={tag.name}
          className={`hero-tag-badge rarity-${tag.rarity}`}
          title={tag.description}
          data-testid="hero-tag-badge"
          data-tag={tag.name}
        >
          {tag.name}
        </span>
      ))}
    </div>
  );
}
