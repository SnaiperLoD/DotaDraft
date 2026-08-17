import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Hero } from 'shared';
import { api } from '../api/client';
import type { DraftStateView, TiFormResponse } from '../api/types';
import { heroPortraitUrl } from '../utils/heroIcon';
import HeroPool from '../components/HeroPool';
import RoleAssignment from '../components/RoleAssignment';
import DraftLedger from '../components/DraftLedger';
import DraftProgress from '../components/DraftProgress';
import EvaluationPanel from '../components/EvaluationPanel';
import CommitToPoolButton from '../components/CommitToPoolButton';
import CopyDraftButton from '../components/CopyDraftButton';
import BattlePanel from '../components/BattlePanel';
import TapalkaWidget from '../components/TapalkaWidget';
import { track } from '../telemetry';
import './DraftPage.css';

// Shape-matched placeholder for the first load. The page used to show a
// single centred "Loading…" line, so the whole layout appeared at once
// and shoved the viewport around; this occupies the real footprint from
// the start.
function DraftSkeleton() {
  return (
    <div className="page" aria-busy="true">
      <div className="draft-skeleton-head">
        <div className="skeleton" style={{ width: 180, height: 26 }} />
        <div className="draft-skeleton-rail">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="skeleton draft-skeleton-node" />
          ))}
        </div>
      </div>
      <div className="draft-layout">
        <div className="hero-grid">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="skeleton draft-skeleton-card" />
          ))}
        </div>
        <div className="draft-below">
          <div className="skeleton draft-skeleton-panel" />
        </div>
      </div>
    </div>
  );
}

// Round 1 before the first pick. The server has generated a pool but has
// deliberately written nothing (DraftService.generatePool), so there is no
// draft id yet — which is why this can't just be a DraftStateView.
interface PendingDraft {
  seed: number;
  pool: Hero[];
  rerollUsed: boolean;
}

export default function DraftPage() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingDraft | null>(null);
  const [draft, setDraft] = useState<DraftStateView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tiForm, setTiForm] = useState<TiFormResponse | null>(null);
  // Battle Mode is a separate screen, not a section stacked under the
  // Evaluation (per user). The Evaluation subtree stays mounted underneath
  // (hidden, not unmounted) so returning to it keeps whatever the player
  // already generated — the score, the expanded breakdown — instead of
  // resetting to the "Evaluate" button.
  const [battleView, setBattleView] = useState(false);

  const loadPool = () => {
    api
      .getDraftPool()
      .then(({ seed, pool }) => setPending({ seed, pool, rerollUsed: false }))
      .catch((err) => setError(err.message));
  };

  // No guard against StrictMode's double-invoke, and none needed: fetching
  // a pool writes nothing, so running this twice costs one redundant
  // request and nothing else. That idempotence is the actual fix for the
  // duplicate-draft bug — the old effect called a non-idempotent
  // /draft/start and left an orphan row behind on every mount.
  useEffect(loadPool, []);
  useEffect(() => {
    api
      .getTiForm()
      .then(setTiForm)
      .catch(() => setTiForm(null));
  }, []);

  const handlePick = async (heroId: number) => {
    setLoading(true);
    setError(null);
    try {
      if (draft) {
        setDraft(await api.pickHero(draft.id, heroId));
      } else if (pending) {
        // The first pick is what creates the draft server-side.
        const created = await api.createDraft(pending.seed, heroId, pending.rerollUsed);
        setDraft(created);
        setPending(null);
        track('draft_first_pick', undefined, created.id);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleReroll = async () => {
    setLoading(true);
    setError(null);
    try {
      if (draft) {
        setDraft(await api.reroll(draft.id));
      } else if (pending) {
        // Nothing to decrement yet — the spend is recorded on the pending
        // draft and passed to createDraft() when the first pick lands.
        const { seed, pool } = await api.getDraftPool();
        setPending({ seed, pool, rerollUsed: true });
      }
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
      if (updated.status === 'COMPLETED') {
        track('draft_completed', undefined, updated.id);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleRestart = () => {
    setDraft(null);
    setPending(null);
    setError(null);
    setBattleView(false);
    loadPool();
  };

  if (error) {
    return (
      <div className="page">
        <div className="panel draft-error">
          <p className="error-text">{error}</p>
          <button className="btn btn-secondary" onClick={handleRestart}>
            {t('draft.restart')}
          </button>
        </div>
      </div>
    );
  }

  if (!draft && !pending) return <DraftSkeleton />;

  // Round 1 renders from `pending` and every later round from `draft`, but
  // the markup below is the same either way — the only difference is where
  // the four values it needs come from. `pending` implies round 1, so no
  // heroes are picked and the re-roll allowance is whatever hasn't been
  // spent on the pool that's on screen.
  const status = draft?.status ?? 'PICKING';
  const heroes = draft?.heroes ?? [];
  const pool = draft?.pool ?? pending?.pool ?? [];
  const rerollsRemaining = draft ? draft.rerollsRemaining : pending?.rerollUsed ? 0 : 1;
  const round = heroes.length + (status === 'PICKING' ? 1 : 0);

  return (
    <div className="page">
      {status !== 'COMPLETED' && (
        <>
          <DraftProgress heroes={heroes} totalSlots={5} currentRound={status === 'PICKING' ? round : null} />

          <div className="draft-layout">
            <main className="draft-stage">
              {status === 'PICKING' && (
                <>
                  <div className="pool-hint-row">
                    <p className="pool-hint">{t('draft.poolHint')}</p>
                    {rerollsRemaining > 0 && (
                      <button
                        className="btn btn-ghost btn-sm reroll-btn"
                        onClick={() => void handleReroll()}
                        disabled={loading}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="13"
                          height="13"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          aria-hidden="true"
                        >
                          <path d="M20 11a8 8 0 1 0-.6 4" />
                          <path d="M20 4v7h-7" strokeLinejoin="round" />
                        </svg>
                        {t('draft.reroll', { count: rerollsRemaining })}
                      </button>
                    )}
                  </div>
                  <HeroPool
                    pool={pool}
                    onPick={(heroId) => void handlePick(heroId)}
                    disabled={loading}
                    pickedHeroNames={heroes.map((h) => h.hero.name)}
                    pickedHeroIds={heroes.map((h) => h.heroId)}
                  />
                </>
              )}

              {status === 'ASSIGNING_ROLES' && (
                <RoleAssignment
                  heroes={heroes}
                  onSubmit={(assignments) => void handleAssignRoles(assignments)}
                  submitting={loading}
                />
              )}
            </main>

            <div className="draft-below">
              <DraftLedger heroes={heroes} totalSlots={5} layout="rail" />
            </div>

            <section className="panel draft-waiting-room">
              <div className="draft-waiting-copy">
                <div className="draft-waiting-kicker">
                  {tiForm?.leagueName ?? t('tapalka.tournamentWatch')}
                </div>
                <h3>{t('tapalka.tiFormHeading')}</h3>
                <p>{t('tapalka.tiFormNote', { count: tiForm?.matchCount ?? 0 })}</p>
                <div className="ti-form-list">
                  {(tiForm?.heroes ?? []).map((hero, index) => (
                    <div key={hero.heroId} className="ti-form-hero">
                      <span className="ti-form-rank">{String(index + 1).padStart(2, '0')}</span>
                      <img
                        src={heroPortraitUrl(hero.heroId)}
                        alt={hero.heroName}
                        width={112}
                        height={70}
                        loading="lazy"
                      />
                      <div className="ti-form-hero-copy">
                        <strong>{hero.heroName}</strong>
                        <span>
                          {t('tapalka.tiRecord', {
                            wins: hero.wins,
                            losses: hero.losses,
                            rate: Math.round(hero.winRate * 100),
                          })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <TapalkaWidget embedded />
            </section>
          </div>
        </>
      )}

      {/* `draft &&` rather than the derived `status`: this branch needs the
          draft id, so it has to be the narrowing that TypeScript follows. */}
      {draft && draft.status === 'COMPLETED' && (
        <div className="completed-section">
          {/* Evaluation screen — kept mounted while the battle screen is up
              (hidden, not unmounted) so returning preserves its state. */}
          <div className="completed-view" hidden={battleView}>
            <DraftLedger heroes={draft.heroes} totalSlots={5} title={t('draft.yourTeam')} />
            <EvaluationPanel draftId={draft.id} heroes={draft.heroes} />
            <div className="completed-tools">
              <CommitToPoolButton draftId={draft.id} />
              <CopyDraftButton
                heroes={draft.heroes.map((h) => ({
                  heroName: h.hero.name,
                  assignedRole: h.assignedRole,
                  pickOrder: h.pickOrder,
                }))}
              />
            </div>
            <div className="completed-actions">
              <button
                className="btn btn-primary"
                data-testid="enter-battle-mode"
                onClick={() => {
                  track('battle_enter', undefined, draft.id);
                  setBattleView(true);
                }}
              >
                {t('battle.enterBattleMode')}
              </button>
              <button className="btn btn-secondary" onClick={handleRestart}>
                {t('draft.startNewDraft')}
              </button>
            </div>
          </div>

          {/* Battle screen. `active` drives the auto-start when the player
              crosses over, and gates the roll from firing while hidden. */}
          <div className="completed-view" hidden={!battleView}>
            <BattlePanel
              draftId={draft.id}
              heroes={draft.heroes}
              active={battleView}
              onBack={() => setBattleView(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
