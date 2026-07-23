import { useState } from 'react';
import { ROLES } from 'shared';
import type { DraftHeroView } from '../api/types';
import { heroPortraitUrl } from '../utils/heroIcon';
import { roleTintGradient } from '../utils/heroRoleColor';
import './RoleAssignment.css';

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
      <h3>Assign Roles</h3>
      <div className="role-assignment-grid">
        {heroes.map((h) => (
          <div key={h.heroId} className="role-assignment-card">
            <div className="portrait">
              <img src={heroPortraitUrl(h.heroId)} alt={h.hero.name} width={220} height={137} />
              <div className="role-tint" style={{ background: roleTintGradient(h.hero) }} />
              <div className="portrait-shade">
                <div className="hero-name">{h.hero.name}</div>
              </div>
            </div>
            <select
              className="role-select"
              value={roleByHero[h.heroId] ?? ''}
              onChange={(e) => setRoleByHero((prev) => ({ ...prev, [h.heroId]: e.target.value }))}
              required
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
      <button className="btn btn-primary" onClick={handleSubmit} disabled={!allAssigned || submitting}>
        Confirm Roles
      </button>
    </div>
  );
}
