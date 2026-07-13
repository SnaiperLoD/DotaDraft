import type { DraftHeroView } from '../api/types';
import { heroIconUrl } from '../utils/heroIcon';

const SLOT_SIZE = 40;

interface Props {
  heroes: DraftHeroView[];
  totalSlots: number;
}

export default function PickedHeroesStrip({ heroes, totalSlots }: Props) {
  const sorted = heroes.slice().sort((a, b) => a.pickOrder - b.pickOrder);
  const emptySlots = totalSlots - sorted.length;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        display: 'flex',
        gap: 8,
        padding: 12,
        borderTop: '1px solid #333',
        background: '#111',
      }}
    >
      {sorted.map((h) => (
        <img
          key={h.heroId}
          src={heroIconUrl(h.heroId)}
          alt={h.hero.name}
          title={h.hero.name}
          width={SLOT_SIZE}
          height={SLOT_SIZE}
          style={{
            flexShrink: 0,
            width: SLOT_SIZE,
            height: SLOT_SIZE,
            objectFit: 'cover',
            borderRadius: 4,
          }}
        />
      ))}
      {Array.from({ length: Math.max(0, emptySlots) }).map((_, i) => (
        <div
          key={`empty-${i}`}
          style={{
            flexShrink: 0,
            width: SLOT_SIZE,
            height: SLOT_SIZE,
            borderRadius: 4,
            border: '1px dashed #555',
          }}
        />
      ))}
    </div>
  );
}
