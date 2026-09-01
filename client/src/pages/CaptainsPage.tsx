import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CaptainsStateView, CmLane, CmSlot, Hero } from 'shared';
import { CM_STEPS } from 'shared';
import { api } from '../api/client';
import type { DraftStateView } from '../api/types';
import { heroSplashUrl } from '../utils/heroIcon';
import { attributeLabel } from '../i18n/display';
import RoleAssignment from '../components/RoleAssignment';
import EvaluationPanel from '../components/EvaluationPanel';
import BattlePanel from '../components/BattlePanel';
import './CaptainsPage.css';

const ATTR_ORDER = ['str', 'agi', 'int', 'all'] as const;
const SPLASH_MS = 2000;

function formatMs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/** 7.40 CM: ban1 / pick1 / ban2 / pick2 / ban3 / pick3 */
function cmPhase(stepIndex: number): number {
  if (stepIndex <= 6) return 0;
  if (stepIndex <= 8) return 1;
  if (stepIndex <= 11) return 2;
  if (stepIndex <= 17) return 3;
  if (stepIndex <= 21) return 4;
  return 5;
}

function SequenceBar({ currentIndex }: { currentIndex: number }) {
  return (
    <ol className="cm-seq" data-testid="cm-seq">
      {CM_STEPS.map((step, i) => {
        const gap = i > 0 && cmPhase(i) !== cmPhase(i - 1);
        return (
          <li
            key={i}
            className={`cm-seq-tick cm-seq-tick--${step.type} cm-seq-tick--${step.lane}${
              gap ? ' is-phase' : ''
            }${i === currentIndex ? ' is-now' : ''}${i < currentIndex ? ' is-done' : ''}`}
          >
            {step.type === 'ban' ? 'B' : 'P'}
          </li>
        );
      })}
    </ol>
  );
}

function TeamColumn({
  lane,
  slots,
  currentIndex,
  heroes,
}: {
  lane: CmLane;
  slots: CmSlot[];
  currentIndex: number;
  heroes: Map<number, Hero>;
}) {
  const items = slots.map((slot, index) => ({ slot, index })).filter((row) => row.slot.lane === lane);
  const side = lane === 'first' ? 'radiant' : 'dire';

  return (
    <aside className={`cm-col cm-col--${side}`} data-testid={`cm-col-${side}`}>
      {items.map((row, n) => {
        const gap = n > 0 && cmPhase(items[n - 1].index) !== cmPhase(row.index);
        const hero = row.slot.heroId != null ? heroes.get(row.slot.heroId) : null;
        const active = row.index === currentIndex;
        return (
          <Fragment key={row.index}>
            {gap ? <div className="cm-phase-break" /> : null}
            <div
              className={`cm-slot cm-slot--${row.slot.type}${hero ? ' is-filled' : ''}${
                active ? ' is-active' : ''
              }`}
              data-step={row.index + 1}
            >
              <span className="cm-slot-n">{row.index + 1}</span>
              {hero ? (
                <>
                  <img src={heroSplashUrl(hero.id)} alt={hero.name} />
                  {row.slot.type === 'ban' ? (
                    <span className="cm-ban-x" aria-hidden="true">
                      ✕
                    </span>
                  ) : (
                    <span className="cm-pick-name">{hero.name}</span>
                  )}
                </>
              ) : (
                <span className="cm-slot-label">{row.slot.type === 'ban' ? 'BAN' : 'PICK'}</span>
              )}
            </div>
          </Fragment>
        );
      })}
    </aside>
  );
}

export default function CaptainsPage() {
  const { t } = useTranslation();
  const [roster, setRoster] = useState<Hero[]>([]);
  const [state, setState] = useState<CaptainsStateView | null>(null);
  const [splash, setSplash] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(Date.now());
  const [playerDraft, setPlayerDraft] = useState<DraftStateView | null>(null);
  const [aiDraft, setAiDraft] = useState<DraftStateView | null>(null);
  const [fighting, setFighting] = useState(false);

  useEffect(() => {
    void api
      .getHeroes()
      .then(setRoster)
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void api
        .startCaptains()
        .then((view) => {
          setState(view);
          setSplash(false);
        })
        .catch((err) => {
          setError((err as Error).message);
          setSplash(false);
        });
    }, SPLASH_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!state?.draftId) return;
    void api
      .getDraft(state.draftId)
      .then(setPlayerDraft)
      .catch((err) => setError((err as Error).message));
  }, [state?.draftId, state?.status]);

  useEffect(() => {
    if (!state?.aiDraftId) return;
    void api
      .getDraft(state.aiDraftId)
      .then(setAiDraft)
      .catch((err) => setError((err as Error).message));
  }, [state?.aiDraftId]);

  useEffect(() => {
    if (!state || state.acting !== 'player' || busy || state.status !== 'DRAFTING') return;
    const ends = new Date(state.stepEndsAt).getTime();
    if (now < ends + state.playerReserveMs) return;
    setBusy(true);
    void api
      .actCaptains(state.id, null, true)
      .then(setState)
      .catch((err) => setError((err as Error).message))
      .finally(() => setBusy(false));
  }, [state, now, busy]);

  const heroesById = useMemo(() => new Map(roster.map((h) => [h.id, h])), [roster]);
  const picked = useMemo(() => {
    const ids = new Set<number>();
    if (!state) return ids;
    for (const id of [...state.playerHeroIds, ...state.aiHeroIds]) ids.add(id);
    return ids;
  }, [state]);
  const banned = useMemo(() => new Set(state?.bannedHeroIds ?? []), [state]);

  const playerSlots = state?.slots.filter((s) => s.lane === 'first') ?? [];
  const aiSlots = state?.slots.filter((s) => s.lane === 'second') ?? [];
  const remainingMs = state ? new Date(state.stepEndsAt).getTime() - now : 0;
  const stepClock = Math.max(0, remainingMs);
  const playerStepMs = state?.acting === 'player' ? stepClock : 0;
  const aiStepMs = state?.acting === 'ai' ? stepClock : 0;
  const playerReserve =
    state?.acting === 'player'
      ? Math.max(0, state.playerReserveMs + Math.min(0, remainingMs))
      : (state?.playerReserveMs ?? 0);
  const aiReserve =
    state?.acting === 'ai'
      ? Math.max(0, state.aiReserveMs + Math.min(0, remainingMs))
      : (state?.aiReserveMs ?? 0);

  const handlePick = async (heroId: number) => {
    if (!state || busy || state.acting !== 'player' || picked.has(heroId) || banned.has(heroId)) return;
    setBusy(true);
    setError(null);
    try {
      setState(await api.actCaptains(state.id, heroId, false));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRoles = async (assignments: { heroId: number; role: string }[]) => {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      setState(await api.assignCaptainsRoles(state.id, assignments));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const q = query.trim().toLowerCase();
  const byAttr = ATTR_ORDER.map((attr) => ({
    attr,
    heroes: roster.filter((h) => h.primary_attribute === attr && h.name.toLowerCase().includes(q)),
  }));
  const step = state?.current;
  const phaseWord = step
    ? step.type === 'ban'
      ? t('captains.ban')
      : t('captains.pick')
    : t('captains.done');
  const whoWord = t(state?.acting === 'player' ? 'captains.you' : 'captains.ai');

  const radiantBanActive =
    state?.status === 'DRAFTING' && state.acting === 'player' && state.current?.type === 'ban'
      ? firstEmpty(playerSlots, 'ban')
      : -1;
  const direBanActive =
    state?.status === 'DRAFTING' && state.acting === 'ai' && state.current?.type === 'ban'
      ? firstEmpty(aiSlots, 'ban')
      : -1;
  const radiantPickActive =
    state?.status === 'DRAFTING' && state.acting === 'player' && state.current?.type === 'pick'
      ? firstEmpty(playerSlots, 'pick')
      : -1;
  const direPickActive =
    state?.status === 'DRAFTING' && state.acting === 'ai' && state.current?.type === 'pick'
      ? firstEmpty(aiSlots, 'pick')
      : -1;

  if (splash || (!state && !error)) {
    return (
      <div className="page captains-page captains-page--splash">
        <div className="cm-splash" data-testid="cm-splash">
          <div className="cm-splash-side cm-splash-side--radiant">
            <span className="cm-splash-faction">{t('captains.radiant')}</span>
          </div>
          <div className="cm-splash-vs">{t('captains.vs')}</div>
          <div className="cm-splash-side cm-splash-side--dire">
            <span className="cm-splash-faction">{t('captains.dire')}</span>
          </div>
          <p className="cm-splash-note">{t('captains.splashNote')}</p>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="page">
        <p className="error-text">{error}</p>
      </div>
    );
  }

  return (
    <div className={`page captains-page${state.status === 'DRAFTING' ? ' captains-page--live' : ''}`}>
      {state.status !== 'DRAFTING' && (
        <>
          <div className="section-head">
            <h2>{t('captains.title')}</h2>
            <div className="rule" />
          </div>
          <p className="captains-note">{t('captains.note')}</p>
        </>
      )}
      {error && <p className="error-text">{error}</p>}

      {state.status === 'DRAFTING' && (
        <div className="cm-stage" data-testid="cm-board">
          <header className="cm-hud">
            <div
              className={`cm-hud-side cm-hud-side--radiant${state.acting === 'player' ? ' is-acting' : ''}`}
            >
              <div className="cm-hud-name">{t('captains.radiant')}</div>
              <div className="cm-hud-clock" data-testid="cm-step-clock">
                {formatMs(playerStepMs)}
              </div>
              <div className="cm-hud-reserve">
                {t('captains.reserve')} {formatMs(playerReserve)}
              </div>
            </div>
            <div className="cm-hud-phase">
              <div className="cm-hud-phase-type">{phaseWord}</div>
              <div className="cm-hud-phase-who">{whoWord}</div>
            </div>
            <div className={`cm-hud-side cm-hud-side--dire${state.acting === 'ai' ? ' is-acting' : ''}`}>
              <div className="cm-hud-name">{t('captains.dire')}</div>
              <div className="cm-hud-clock">{formatMs(aiStepMs)}</div>
              <div className="cm-hud-reserve">
                {t('captains.reserve')} {formatMs(aiReserve)}
              </div>
            </div>
          </header>

          <div className="cm-lanes">
            <aside className="cm-col cm-col--radiant">
              <BanStrip slots={playerSlots} activeIndex={radiantBanActive} />
              <PickRow slots={playerSlots} activeIndex={radiantPickActive} heroes={heroesById} />
            </aside>
            <aside className="cm-col cm-col--dire">
              <BanStrip slots={aiSlots} activeIndex={direBanActive} />
              <PickRow slots={aiSlots} activeIndex={direPickActive} heroes={heroesById} />
            </aside>
          </div>

          <div className="cm-pool">
            <div className="cm-attr-grid" data-testid="cm-hero-grid">
              {byAttr.map((col) => (
                <div key={col.attr} className="cm-attr-col">
                  <div className={`cm-attr-head cm-attr-head--${col.attr}`}>
                    {attributeLabel(t, col.attr)}
                  </div>
                  <div className="cm-attr-heroes">
                    {col.heroes.map((hero) => {
                      const isBanned = banned.has(hero.id);
                      const isPicked = picked.has(hero.id);
                      const locked = isBanned || isPicked;
                      return (
                        <button
                          key={hero.id}
                          type="button"
                          data-testid={`cm-hero-${hero.id}`}
                          className={`cm-hero${isBanned ? ' is-banned' : ''}${isPicked ? ' is-picked' : ''}`}
                          disabled={locked || busy || state.acting !== 'player'}
                          onClick={() => void handlePick(hero.id)}
                          title={hero.name}
                        >
                          <img src={heroSplashUrl(hero.id)} alt={hero.name} />
                          {isBanned && (
                            <span className="cm-hero-x" aria-hidden="true">
                              ✕
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <input
              className="cm-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('captains.search')}
              aria-label={t('captains.search')}
            />
          </div>
        </div>
      )}

      {state.status === 'ASSIGNING_ROLES' && playerDraft && (
        <RoleAssignment heroes={playerDraft.heroes} onSubmit={handleRoles} submitting={busy} />
      )}

      {(state.status === 'READY' || state.status === 'COMPLETED') && playerDraft && (
        <>
          <div className="cm-dual-eval">
            <section>
              <h3>{t('captains.yourEval')}</h3>
              <EvaluationPanel draftId={playerDraft.id} heroes={playerDraft.heroes} autoEvaluate compact />
            </section>
            {aiDraft && (
              <section>
                <h3>{t('captains.aiEval')}</h3>
                <EvaluationPanel draftId={aiDraft.id} heroes={aiDraft.heroes} autoEvaluate compact />
              </section>
            )}
          </div>
          {state.status === 'READY' && !fighting && (
            <button type="button" className="btn btn-primary" onClick={() => setFighting(true)}>
              {t('captains.fight')}
            </button>
          )}
          {fighting && (
            <BattlePanel
              draftId={playerDraft.id}
              heroes={playerDraft.heroes}
              variant="once"
              autoStart
              captainsSessionId={state.id}
              onFought={() => {
                void api.getCaptains(state.id).then(setState);
              }}
            />
          )}
          {state.status === 'COMPLETED' && !fighting && (
            <p className="captains-note">
              {t('captains.fought')} <Link to="/history">{t('app.nav.history')}</Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}
