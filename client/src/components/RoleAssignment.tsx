import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ROLES } from 'shared';
import type { DraftRole, Hero } from 'shared';
import type { DraftHeroView } from '../api/types';
import { heroPortraitUrl, heroIconUrl } from '../utils/heroIcon';
import { roleTintGradient } from '../utils/heroRoleColor';
import './RoleAssignment.css';

interface Props {
  heroes: DraftHeroView[];
  onSubmit: (assignments: { heroId: number; role: string }[]) => void;
  submitting?: boolean;
}

// Positions 1-5 are how Dota players actually name these roles, and five
// numbered cells fit in a card where five full labels never did. The old
// native <select> per hero was the one control in the app that ignored the
// theme entirely — and RoleAssignment.css already recorded "a custom
// dropdown component" as the next step if styling native <option> didn't
// read well enough, which it didn't.
const ROLE_POSITION: Record<DraftRole, number> = {
  Carry: 1,
  Mid: 2,
  Offlane: 3,
  'Soft Support': 4,
  'Hard Support': 5,
};

// hero.presumed_positions is real match data (the same source the portrait
// role-tint reads), so it can mark which slots this hero actually plays.
// A "Support" position covers both support roles — the underlying data
// doesn't split 4 from 5.
function recommendedRoles(hero: Hero): Set<string> {
  const out = new Set<string>();
  for (const p of hero.presumed_positions ?? []) {
    if (p.position === 'Support') {
      out.add('Soft Support');
      out.add('Hard Support');
    } else {
      out.add(p.position);
    }
  }
  return out;
}

export default function RoleAssignment({ heroes, onSubmit, submitting }: Props) {
  const { t } = useTranslation();
  const [roleByHero, setRoleByHero] = useState<Record<number, string>>({});

  const assignedCount = heroes.filter((h) => roleByHero[h.heroId]).length;
  const canSubmit = assignedCount === heroes.length;

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

  // heroId currently holding each role, so a cell can show whose slot it
  // would be taking.
  const holderByRole = new Map<string, number>();
  for (const [heroId, role] of Object.entries(roleByHero)) holderByRole.set(role, Number(heroId));

  return (
    <div className="role-assignment">
      <div className="section-head">
        <h3>{t('roleAssignment.heading')}</h3>
        <div className="rule" />
        <span className="role-assignment-progress">
          {t('roleAssignment.progress', { assigned: assignedCount, total: heroes.length })}
        </span>
      </div>

      <p className="role-assignment-hint">{t('roleAssignment.hint')}</p>

      <div className="role-assignment-grid">
        {heroes.map((h) => {
          const recommended = recommendedRoles(h.hero);
          const selected = roleByHero[h.heroId];
          return (
            <div
              key={h.heroId}
              className={`role-assignment-card role-assignment-card--attr-${h.hero.primary_attribute}${
                selected ? ' is-assigned' : ''
              }`}
            >
              <div className="portrait">
                <img src={heroPortraitUrl(h.heroId)} alt={h.hero.name} width={220} height={137} />
                <div className="role-tint" style={{ background: roleTintGradient(h.hero) }} />
                <div className="portrait-shade">
                  <div className="hero-name">{h.hero.name}</div>
                </div>
              </div>

              <div className="role-picker" role="group" aria-label={t('roleAssignment.selectRole')}>
                {ROLES.map((role) => {
                  const holderId = holderByRole.get(role);
                  const stolenFrom = holderId !== undefined && holderId !== h.heroId ? holderId : null;
                  const stolenFromHero = stolenFrom
                    ? (heroes.find((x) => x.heroId === stolenFrom)?.hero.name ?? '')
                    : '';
                  return (
                    <button
                      key={role}
                      type="button"
                      className={`role-cell${selected === role ? ' is-selected' : ''}${
                        recommended.has(role) ? ' is-recommended' : ''
                      }`}
                      aria-pressed={selected === role}
                      title={
                        stolenFrom
                          ? t('roleAssignment.stealFrom', { role: t(`roles.${role}`), hero: stolenFromHero })
                          : t(`roles.${role}`)
                      }
                      onClick={() => handleRoleChange(h.heroId, role)}
                    >
                      {ROLE_POSITION[role]}
                      {stolenFrom && (
                        <img
                          className="role-cell-holder"
                          src={heroIconUrl(stolenFrom)}
                          alt=""
                          width={14}
                          height={14}
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="role-assignment-readout">
                {selected ? t(`roles.${selected}`) : t('roleAssignment.selectRole')}
              </div>
            </div>
          );
        })}
      </div>

      <button className="btn btn-primary" onClick={handleSubmit} disabled={!canSubmit || submitting}>
        {submitting && <span className="btn-spinner" aria-hidden="true" />}
        {t('roleAssignment.confirm')}
      </button>
    </div>
  );
}
