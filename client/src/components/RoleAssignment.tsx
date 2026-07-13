import { useState } from 'react';
import { ROLES } from 'shared';
import type { DraftHeroView } from '../api/types';
import { heroPortraitUrl } from '../utils/heroIcon';
import { roleTintGradient } from '../utils/heroRoleColor';

interface Props {
  heroes: DraftHeroView[];
  onSubmit: (assignments: { heroId: number; role: string }[]) => void;
  submitting?: boolean;
}

export default function RoleAssignment({ heroes, onSubmit, submitting }: Props) {
  const [roleByHero, setRoleByHero] = useState<Record<number, string>>({});

  const allAssigned = heroes.every((h) => roleByHero[h.heroId]);

  const handleSubmit = () => {
    onSubmit(heroes.map((h) => ({ heroId: h.heroId, role: roleByHero[h.heroId] })));
  };

  return (
    <div>
      <h3>Assign roles</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {heroes.map((h) => (
          <div key={h.heroId} style={{ width: 220 }}>
            <div
              style={{
                position: 'relative',
                width: 220,
                height: 137,
                borderRadius: 6,
                overflow: 'hidden',
              }}
            >
              <img
                src={heroPortraitUrl(h.heroId)}
                alt={h.hero.name}
                width={220}
                height={137}
                style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: roleTintGradient(h.hero),
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
                  background:
                    'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.55) 55%, transparent 100%)',
                }}
              >
                <div
                  style={{ fontWeight: 'bold', color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
                >
                  {h.hero.name}
                </div>
              </div>
            </div>
            <select
              value={roleByHero[h.heroId] ?? ''}
              onChange={(e) => setRoleByHero((prev) => ({ ...prev, [h.heroId]: e.target.value }))}
              style={{ width: '100%', marginTop: 6 }}
            >
              <option value="" disabled>
                Select role
              </option>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <button onClick={handleSubmit} disabled={!allAssigned || submitting} style={{ marginTop: 16 }}>
        Confirm roles
      </button>
    </div>
  );
}
