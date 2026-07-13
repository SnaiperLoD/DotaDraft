import type { Hero } from 'shared';
import { heroPortraitUrl } from '../utils/heroIcon';
import { roleTintGradient } from '../utils/heroRoleColor';

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
            position: 'relative',
            width: 220,
            height: 137,
            padding: 0,
            border: 'none',
            borderRadius: 6,
            overflow: 'hidden',
            cursor: disabled ? 'default' : 'pointer',
          }}
        >
          <img
            src={heroPortraitUrl(hero.id)}
            alt={hero.name}
            width={220}
            height={137}
            style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: roleTintGradient(hero),
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              padding: '20px 10px 8px',
              textAlign: 'left',
              background: 'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.55) 55%, transparent 100%)',
            }}
          >
            <div style={{ fontWeight: 'bold', color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
              {hero.name}
            </div>
            <div style={{ fontSize: 12, color: '#e5e5e5', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
              {hero.roles.join(', ')}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
