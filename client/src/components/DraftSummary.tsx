import type { DraftHeroView } from '../api/types';

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
            <div key={h.heroId} style={{ display: 'flex', gap: 12 }}>
              <span style={{ width: 24, opacity: 0.6 }}>#{h.pickOrder}</span>
              <span style={{ width: 140, fontWeight: 'bold' }}>{h.hero.name}</span>
              <span>{h.assignedRole}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
