import type { Hero } from 'shared';

interface Props {
  pool: Hero[];
  onPick: (heroId: number) => void;
  disabled?: boolean;
}

export default function HeroPool({ pool, onPick, disabled }: Props) {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {pool.map((hero) => (
        <button
          key={hero.id}
          onClick={() => onPick(hero.id)}
          disabled={disabled}
          style={{
            width: 140,
            padding: 12,
            textAlign: 'left',
            cursor: disabled ? 'default' : 'pointer',
          }}
        >
          <div style={{ fontWeight: 'bold' }}>{hero.name}</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{hero.roles.join(', ')}</div>
        </button>
      ))}
    </div>
  );
}
