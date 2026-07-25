import type { Hero } from 'shared';
import { heroPortraitUrl } from '../utils/heroIcon';
import { roleTintGradient } from '../utils/heroRoleColor';
import { visibleTagsFor } from '../data/customTags';
import HeroTagBadges from './HeroTagBadges';
import './HeroPool.css';

interface Props {
  pool: Hero[];
  onPick: (heroId: number) => void;
  disabled?: boolean;
  // Names of already-picked heroes — passed to visibleTagsFor so a pool
  // card's revealable tags show as revealed when picking it would
  // complete (or maintain) a synergy already in progress.
  pickedHeroNames?: string[];
}

export default function HeroPool({ pool, onPick, disabled, pickedHeroNames = [] }: Props) {
  return (
    <div className="hero-grid">
      {pool.map((hero) => (
        <button key={hero.id} className="hero-card" onClick={() => onPick(hero.id)} disabled={disabled}>
          <div className="portrait">
            <img src={heroPortraitUrl(hero.id)} alt={hero.name} width={220} height={137} />
            <div className="role-tint" style={{ background: roleTintGradient(hero) }} />
            <HeroTagBadges tags={visibleTagsFor(hero.name, [...pickedHeroNames, hero.name])} />
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
