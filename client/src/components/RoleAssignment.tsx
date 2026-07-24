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
  const assignedRoles = Object.values(roleByHero);
  const rolesAreUnique = new Set(assignedRoles).size === assignedRoles.length;
  const canSubmit = allAssigned && rolesAreUnique;

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
              {ROLES.map((role) => {
                const takenByOther = assignedRoles.includes(role) && roleByHero[h.heroId] !== role;
                return (
                  <option key={role} value={role} disabled={takenByOther}>
                    {role}
                    {takenByOther ? ' (taken)' : ''}
                  </option>
                );
              })}
            </select>
          </div>
        ))}
      </div>
      {allAssigned && !rolesAreUnique && (
        <p className="role-assignment-error">Each role must be assigned to a different hero.</p>
      )}
      <button className="btn btn-primary" onClick={handleSubmit} disabled={!canSubmit || submitting}>
        Confirm Roles
      </button>
    </div>
  );
}
