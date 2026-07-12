import { useState } from 'react';
import { ROLES } from 'shared';
import type { DraftHeroView } from '../api/types';

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {heroes.map((h) => (
          <div key={h.heroId} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 140 }}>{h.hero.name}</span>
            <select
              value={roleByHero[h.heroId] ?? ''}
              onChange={(e) =>
                setRoleByHero((prev) => ({ ...prev, [h.heroId]: e.target.value }))
              }
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
      <button
        onClick={handleSubmit}
        disabled={!allAssigned || submitting}
        style={{ marginTop: 16 }}
      >
        Confirm roles
      </button>
    </div>
  );
}
