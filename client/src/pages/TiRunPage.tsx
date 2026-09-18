import { lazy, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Hero, TiPathFight, TiRunStateView, TiTeamCard } from 'shared';
import { api } from '../api/client';
import { TI_RUN_SESSION_KEY } from '../utils/submitterToken';
import type { DraftStateView } from '../api/types';
import HeroPool from '../components/HeroPool';
import RoleAssignment from '../components/RoleAssignment';
import DraftLedger from '../components/DraftLedger';
import DraftProgress from '../components/DraftProgress';
import EvaluationPanel from '../components/EvaluationPanel';
import TiBracket from '../components/TiBracket';
import TeamCrest from '../components/TeamCrest';
import './TiRunPage.css';

const BattlePanel = lazy(() => import('../components/BattlePanel'));
const SESSION_KEY = TI_RUN_SESSION_KEY;

function strongestFight(path: TiPathFight[]): TiPathFight | null {
  if (path.length === 0) return null;
  const losses = path.filter((f) => f.outcome === 'Lose');
  if (losses.length >= 1) return losses[0];
  return path.find((f) => f.advantageDirection !== 'A') ?? path[path.length - 1];
}

function weakestFight(path: TiPathFight[]): TiPathFight | null {
  if (path.length === 0) return null;
  const stomps = path.filter((f) => f.outcome === 'Win' && f.advantageDirection === 'A');
  return stomps[stomps.length - 1] ?? path.find((f) => f.outcome === 'Win') ?? path[0];
}

function TeamCard({ team, onPick }: { team: TiTeamCard; onPick: (name: string) => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="ti-team-card" onClick={() => onPick(team.name)}>
      <TeamCrest name={team.name} size={56} />
      <strong>{team.name}</strong>
      <ul>
        {(team.players.length > 0 ? team.players : [t('tiRun.noPlayers')]).map((player) => (
          <li key={player}>{player}</li>
        ))}
      </ul>
    </button>
  );
}

function PathNote({ fight, label }: { fight: TiPathFight | null; label: string }) {
  if (!fight) return null;
  return (
    <p>
      {label}: {fight.round} vs {fight.opponent} — {fight.outcome}
    </p>
  );
}

export default function TiRunPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const resumeParam = searchParams.get('resume');
  const [run, setRun] = useState<TiRunStateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ seed: number; pool: Hero[]; rerollUsed: boolean } | null>(null);
  const [draft, setDraft] = useState<DraftStateView | null>(null);
  const [playView, setPlayView] = useState<'bracket' | 'eval' | 'fight'>('bracket');
  const [fightMatchId, setFightMatchId] = useState<string | null>(null);

  const boot = async (existingId?: string | null) => {
    try {
      if (existingId) {
        const view = await api.getTiRun(existingId);
        localStorage.setItem(SESSION_KEY, view.id);
        setRun(view);
        if (view.draftId) setDraft(await api.getDraft(view.draftId));
        return;
      }
      const view = await api.startTiRun();
      localStorage.setItem(SESSION_KEY, view.id);
      setRun(view);
    } catch (err) {
      if (existingId) {
        localStorage.removeItem(SESSION_KEY);
        await boot(null);
        return;
      }
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    void boot(resumeParam ?? localStorage.getItem(SESSION_KEY));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeParam]);

  const syncDraft = async (next: DraftStateView) => {
    setDraft(next);
    if (!run) return;
    setRun(await api.attachTiRunDraft(run.id, next.id));
  };

  const handlePick = async (heroId: number) => {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      if (draft) {
        await syncDraft(await api.pickHero(draft.id, heroId));
      } else if (pending) {
        const created = await api.createDraft(pending.seed, heroId, pending.rerollUsed, 'ti');
        setPending(null);
        await syncDraft(created);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleReroll = async () => {
    setBusy(true);
    setError(null);
    try {
      if (draft) {
        setDraft(await api.reroll(draft.id));
      } else if (pending) {
        const { seed, pool } = await api.getDraftPool();
        setPending({ seed, pool, rerollUsed: true });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRoles = async (assignments: { heroId: number; role: string }[]) => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await syncDraft(await api.assignRoles(draft.id, assignments));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startDraft = async () => {
    setBusy(true);
    setError(null);
    try {
      const { seed, pool } = await api.getDraftPool();
      setPending({ seed, pool, rerollUsed: false });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chooseTeam = async (name: string) => {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      setRun(await api.chooseTiRunTeam(run.id, name));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startFight = () => {
    if (!run?.currentMatchId) return;
    setFightMatchId(run.currentMatchId);
    setPlayView('fight');
  };

  const newRun = () => {
    localStorage.removeItem(SESSION_KEY);
    setRun(null);
    setDraft(null);
    setPending(null);
    setPlayView('bracket');
    setFightMatchId(null);
    setError(null);
    void boot(null);
  };

  if (!run) {
    return (
      <div className="page">
        {error ? <p className="error-text">{error}</p> : <p>{t('tiRun.loading')}</p>}
      </div>
    );
  }

  const pool = draft?.pool ?? pending?.pool ?? [];
  const heroes = draft?.heroes ?? [];
  const status = draft?.status ?? 'PICKING';
  const rerollsRemaining = draft ? draft.rerollsRemaining : pending?.rerollUsed ? 0 : 1;
  const drafting = Boolean(pending) || (draft && status !== 'COMPLETED' && run.status !== 'PLAYING');
  const ended = run.status === 'CHAMPION' || run.status === 'ELIMINATED';
  const readyToPlay = (run.status === 'PLAYING' || ended) && draft?.status === 'COMPLETED';
  const currentMatch = run.matches.find((m) => m.id === run.currentMatchId);
  const stagePick = (currentMatch?.matchIds?.length ?? 0) > 0;

  return (
    <div className="page ti-run-page">
      <div className="section-head">
        <h2>
          {t('tiRun.title')} · {run.leagueName}
        </h2>
        <div className="rule" />
      </div>
      {error && <p className="error-text">{error}</p>}

      {draft?.status === 'COMPLETED' && (
        <div className="ti-eval-screen" hidden={playView !== 'eval'} data-testid="ti-eval-screen">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlayView('bracket')}>
            {t('tiRun.backToRun')}
          </button>
          <p className="ti-copy">{t('tiRun.optionalEval')}</p>
          <EvaluationPanel draftId={draft.id} heroes={draft.heroes} />
        </div>
      )}

      {playView === 'fight' && draft && (
        <div className="ti-fight-screen" data-testid="ti-fight-screen">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlayView('bracket')}>
            {t('tiRun.backToRun')}
          </button>
          {run.opponentName && (
            <p className="ti-copy ti-copy--emphasis">
              {t(stagePick ? 'tiRun.opponentDraftStage' : 'tiRun.opponentDraftAny', {
                team: run.opponentName,
                league: run.leagueName,
                round: run.currentRound ?? currentMatch?.round ?? '',
              })}
            </p>
          )}
          <Suspense fallback={<p className="ti-copy">{t('tiRun.loading')}</p>}>
            <BattlePanel
              key={fightMatchId ?? 'fight'}
              draftId={draft.id}
              heroes={draft.heroes}
              variant="once"
              autoStart
              tiRunId={run.id}
              backLabel={t('tiRun.backToRun')}
              onBack={() => setPlayView('bracket')}
              onFought={() => {
                void api.getTiRun(run.id).then(setRun);
              }}
            />
          </Suspense>
          {run.status === 'PLAYING' && run.currentMatchId && run.currentMatchId !== fightMatchId && (
            <button type="button" className="btn btn-primary" onClick={startFight}>
              {t('tiRun.nextMatch')}
            </button>
          )}
        </div>
      )}

      {playView === 'bracket' && (
        <>
          {run.status === 'PICKING_TEAM' && (
            <>
              <p className="ti-copy">{t('tiRun.pickTeam')}</p>
              <p className="ti-copy ti-tree-note" data-testid="ti-tree-note">
                {t('tiRun.treeNote')}
              </p>
              <div className="ti-team-grid">
                {run.teams.map((team) => (
                  <TeamCard key={team.name} team={team} onPick={(name) => void chooseTeam(name)} />
                ))}
              </div>
            </>
          )}

          {run.status !== 'PICKING_TEAM' && (
            <>
              {run.teamName && (
                <p className="ti-copy ti-you">
                  <TeamCrest name={run.teamName} size={28} />
                  {t('tiRun.yourTeam', { team: run.teamName })}
                </p>
              )}
              <p className="ti-copy ti-tree-note" data-testid="ti-tree-note">
                {t('tiRun.treeNote')}
              </p>
              <TiBracket
                matches={run.matches}
                currentMatchId={run.currentMatchId}
                playerTeam={run.teamName}
                upperLabel={t('tiRun.bracketUpper')}
                lowerLabel={t('tiRun.bracketLower')}
                grandLabel={t('tiRun.bracketGrand')}
                finale={
                  run.status === 'CHAMPION' ? 'champion' : run.status === 'ELIMINATED' ? 'eliminated' : null
                }
              />
            </>
          )}

          {run.status === 'SHOWING_BRACKET' && !pending && !draft && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void startDraft()}
            >
              {t('tiRun.startDraft')}
            </button>
          )}

          {drafting && (pending || draft) && status === 'PICKING' && (
            <>
              <DraftProgress heroes={heroes} totalSlots={5} currentRound={heroes.length + 1} />
              <HeroPool
                pool={pool}
                onPick={(id) => void handlePick(id)}
                disabled={busy}
                pickedHeroNames={heroes.map((h) => h.hero.name)}
                pickedHeroIds={heroes.map((h) => h.heroId)}
              />
              {rerollsRemaining > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => void handleReroll()}
                >
                  {t('draft.reroll', { count: rerollsRemaining })}
                </button>
              )}
              <DraftLedger heroes={heroes} totalSlots={5} layout="rail" />
            </>
          )}

          {draft && status === 'ASSIGNING_ROLES' && (
            <RoleAssignment
              heroes={draft.heroes}
              onSubmit={(assignments) => {
                void handleRoles(assignments);
              }}
              submitting={busy}
            />
          )}

          {readyToPlay && (
            <div className="ti-play-bar">
              {run.status === 'PLAYING' && run.currentRound && run.opponentName && (
                <>
                  <p className="ti-match-now">
                    <TeamCrest name={run.opponentName} size={28} />
                    {t('tiRun.currentMatch', { round: run.currentRound, opponent: run.opponentName })}
                  </p>
                  <p className="ti-copy ti-copy--emphasis">
                    {t(stagePick ? 'tiRun.opponentDraftStage' : 'tiRun.opponentDraftAny', {
                      team: run.opponentName,
                      league: run.leagueName,
                      round: run.currentRound,
                    })}
                  </p>
                </>
              )}
              <div className="ti-play-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setPlayView('eval')}>
                  {t('tiRun.openEval')}
                </button>
                {run.status === 'PLAYING' && (
                  <button type="button" className="btn btn-primary" onClick={startFight}>
                    {run.path.length === 0 ? t('tiRun.fight') : t('tiRun.nextMatch')}
                  </button>
                )}
              </div>
            </div>
          )}

          {ended && (
            <section className="ti-end panel bracketed">
              <h3>{run.status === 'CHAMPION' ? t('tiRun.champion') : t('tiRun.eliminated')}</h3>
              <p>{t('tiRun.path')}</p>
              <ol className="ti-path">
                {run.path.map((fight) => (
                  <li key={fight.matchId}>
                    {fight.round} vs {fight.opponent}: {fight.outcome}
                  </li>
                ))}
              </ol>
              <PathNote fight={strongestFight(run.path)} label={t('tiRun.strongest')} />
              <PathNote fight={weakestFight(run.path)} label={t('tiRun.weakest')} />
              <button type="button" className="btn btn-secondary" onClick={newRun}>
                {t('tiRun.newRun')}
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
