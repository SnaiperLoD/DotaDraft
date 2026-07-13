import type { DraftHeroView } from '../api/types';
import { heroIconUrl } from '../utils/heroIcon';

interface Props {
  heroes: DraftHeroView[];
}

export default function DraftSummary({ heroes }: Props) {
  return (
    <div>
      <h3>Your team</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {heroes
          .slice()
          .sort((a, b) => a.pickOrder - b.pickOrder)
          .map((h) => (
            <div key={h.heroId} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 24, opacity: 0.6 }}>#{h.pickOrder}</span>
              <img
                src={heroIconUrl(h.heroId)}
                alt={h.hero.name}
                width={40}
                height={40}
                style={{ flexShrink: 0, width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }}
              />
              <span style={{ width: 140, fontWeight: 'bold' }}>{h.hero.name}</span>
              <span>{h.assignedRole}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
