import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
      <h3>{t('roleAssignment.heading')}</h3>
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
                {t('roleAssignment.selectRole')}
              </option>
              {ROLES.map((role) => {
                const takenByOther = assignedRoles.includes(role) && roleByHero[h.heroId] !== role;
                return (
                  <option key={role} value={role} disabled={takenByOther}>
                    {t(`roles.${role}`)}
                    {takenByOther ? ` ${t('roleAssignment.taken')}` : ''}
                  </option>
                );
              })}
            </select>
          </div>
        ))}
      </div>
      {allAssigned && !rolesAreUnique && <p className="role-assignment-error">{t('roleAssignment.error')}</p>}
      <button className="btn btn-primary" onClick={handleSubmit} disabled={!canSubmit || submitting}>
        {t('roleAssignment.confirm')}
      </button>
    </div>
  );
}
