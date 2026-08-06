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
  const canSubmit = allAssigned;

  // Picking a role already held by another hero steals it — the previous
  // holder goes back to unassigned rather than the pick being blocked
  // (Blueprint/10-tech-debt-backlog.md, "RoleAssignment: 'перещёлкивание'
  // роли", by direct user request). Selecting a role is itself how you
  // reassign it now, so there's no "taken" state left to disable against —
  // and since every change routes through this function, roleByHero's
  // values are unique by construction, not just checked after the fact.
  const handleRoleChange = (heroId: number, role: string) => {
    setRoleByHero((prev) => {
      const next = { ...prev };
      const previousHolderId = Object.keys(next).find(
        (id) => Number(id) !== heroId && next[Number(id)] === role,
      );
      if (previousHolderId) delete next[Number(previousHolderId)];
      next[heroId] = role;
      return next;
    });
  };

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
              onChange={(e) => handleRoleChange(h.heroId, e.target.value)}
              required
            >
              <option value="" disabled>
                {t('roleAssignment.selectRole')}
              </option>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(`roles.${role}`)}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <button className="btn btn-primary" onClick={handleSubmit} disabled={!canSubmit || submitting}>
        {t('roleAssignment.confirm')}
      </button>
    </div>
  );
}
