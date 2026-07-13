import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { DraftStateView } from '../api/types';
import HeroPool from '../components/HeroPool';
import RoleAssignment from '../components/RoleAssignment';
import DraftSummary from '../components/DraftSummary';
import EvaluationPanel from '../components/EvaluationPanel';
import PickedHeroesStrip from '../components/PickedHeroesStrip';
import CommitToPoolButton from '../components/CommitToPoolButton';
import BattlePanel from '../components/BattlePanel';

export default function DraftPage() {
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
    api.startDraft().then(setDraft).catch((err) => setError(err.message));
  };

  if (error) {
    return (
      <div>
        <p style={{ color: 'red' }}>{error}</p>
        <button onClick={handleRestart}>Restart</button>
      </div>
    );
  }

  if (!draft) return <p>Loading...</p>;

  return (
    <div style={{ paddingBottom: draft.status !== 'COMPLETED' ? 64 : 0 }}>
      <h2>Draft — round {draft.heroes.length + (draft.status === 'PICKING' ? 1 : 0)} / 5</h2>

      {draft.status === 'PICKING' && (
        <HeroPool pool={draft.pool} onPick={handlePick} disabled={loading} />
      )}

      {draft.status === 'ASSIGNING_ROLES' && (
        <RoleAssignment heroes={draft.heroes} onSubmit={handleAssignRoles} submitting={loading} />
      )}

      {draft.status === 'COMPLETED' && (
        <>
          <DraftSummary heroes={draft.heroes} />
          <EvaluationPanel draftId={draft.id} />
          <CommitToPoolButton draftId={draft.id} />
          <BattlePanel draftId={draft.id} heroes={draft.heroes} />
          <button onClick={handleRestart} style={{ marginTop: 16 }}>
            Start new draft
          </button>
        </>
      )}

      {draft.status !== 'COMPLETED' && (
        <PickedHeroesStrip heroes={draft.heroes} totalSlots={5} />
      )}
    </div>
  );
}
