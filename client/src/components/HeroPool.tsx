import type { Hero } from 'shared';
import { heroPortraitUrl } from '../utils/heroIcon';
import { roleTintGradient } from '../utils/heroRoleColor';
import './HeroPool.css';

interface Props {
  pool: Hero[];
  onPick: (heroId: number) => void;
  disabled?: boolean;
}

export default function HeroPool({ pool, onPick, disabled }: Props) {
  return (
    <div className="hero-grid">
      {pool.map((hero) => (
        <button key={hero.id} className="hero-card" onClick={() => onPick(hero.id)} disabled={disabled}>
          <div className="portrait">
            <img src={heroPortraitUrl(hero.id)} alt={hero.name} width={220} height={137} />
            <div className="role-tint" style={{ background: roleTintGradient(hero) }} />
            <div className="portrait-shade">
              <div className="hero-name">{hero.name}</div>
            </div>
          </div>
          <div className="card-body">
            {hero.roles.slice(0, 3).map((role) => (
              <span key={role} className="pill">
                {role}
              </span>
            ))}
          </div>
        </button>
      ))}
    </div>
  );
}
