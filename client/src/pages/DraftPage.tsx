import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { DraftStateView } from '../api/types';
import HeroPool from '../components/HeroPool';
import RoleAssignment from '../components/RoleAssignment';
import DraftLedger from '../components/DraftLedger';
import EvaluationPanel from '../components/EvaluationPanel';
import CommitToPoolButton from '../components/CommitToPoolButton';
import BattlePanel from '../components/BattlePanel';
import AdSlot from '../components/AdSlot';
import TapalkaWidget from '../components/TapalkaWidget';
import './DraftPage.css';

export default function DraftPage() {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<DraftStateView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .startDraft()
      .then(setDraft)
      .catch((err) => setError(err.message));
  }, []);

  const handlePick = async (heroId: number) => {
    if (!draft) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await api.pickHero(draft.id, heroId);
      setDraft(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleReroll = async () => {
    if (!draft) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await api.reroll(draft.id);
      setDraft(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleAssignRoles = async (assignments: { heroId: number; role: string }[]) => {
    if (!draft) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await api.assignRoles(draft.id, assignments);
      setDraft(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleRestart = () => {
    setDraft(null);
    setError(null);
    api
      .startDraft()
      .then(setDraft)
      .catch((err) => setError(err.message));
  };

  if (error) {
    return (
      <div className="page">
        <div className="draft-error">
          <p className="error-text">{error}</p>
          <button className="btn btn-secondary" onClick={handleRestart}>
            {t('draft.restart')}
          </button>
        </div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="page">
        <p className="draft-loading loading-text">{t('draft.loading')}</p>
      </div>
    );
  }

  const round = draft.heroes.length + (draft.status === 'PICKING' ? 1 : 0);

  return (
    <div className="page">
      {draft.status !== 'COMPLETED' && (
        <>
          <div className="round-banner">
            <h1>
              <em>{t('draft.roundNumber', { round })}</em> {t('draft.ofFive')}
            </h1>
            <div className="rule" />
          </div>

          <AdSlot size="leaderboard" />

          <div className="draft-layout" style={{ marginTop: 24 }}>
            <main>
              {draft.status === 'PICKING' && (
                <>
                  <div className="pool-hint-row">
                    <p className="pool-hint">{t('draft.poolHint')}</p>
                    {draft.rerollsRemaining > 0 && (
                      <button className="btn btn-secondary reroll-btn" onClick={() => void handleReroll()} disabled={loading}>
                        {t('draft.reroll', { count: draft.rerollsRemaining })}
                      </button>
                    )}
                  </div>
                  <HeroPool
                    pool={draft.pool}
                    onPick={(heroId) => void handlePick(heroId)}
                    disabled={loading}
                    pickedHeroNames={draft.heroes.map((h) => h.hero.name)}
                    pickedHeroIds={draft.heroes.map((h) => h.heroId)}
                  />
                </>
              )}

              {draft.status === 'ASSIGNING_ROLES' && (
                <RoleAssignment
                  heroes={draft.heroes}
                  onSubmit={(assignments) => void handleAssignRoles(assignments)}
                  submitting={loading}
                />
              )}
            </main>

            <aside className="draft-sidebar">
              <DraftLedger heroes={draft.heroes} totalSlots={5} />
              <TapalkaWidget />
              <AdSlot size="rectangle" />
            </aside>
          </div>
        </>
      )}

      {draft.status === 'COMPLETED' && (
        <div className="completed-section">
          <DraftLedger heroes={draft.heroes} totalSlots={5} title={t('draft.yourTeam')} />
          <EvaluationPanel draftId={draft.id} heroes={draft.heroes} />
          <CommitToPoolButton draftId={draft.id} />
          <BattlePanel draftId={draft.id} heroes={draft.heroes} />
          <div className="completed-actions">
            <button className="btn btn-secondary" onClick={handleRestart}>
              {t('draft.startNewDraft')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
