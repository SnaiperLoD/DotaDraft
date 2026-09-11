import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CaptainsStateView, CmActionType, CmSlot, Hero } from 'shared';
import { CM_STEPS } from 'shared';
import { api } from '../api/client';
import type { DraftStateView } from '../api/types';
import { heroIconUrl, heroSplashUrl } from '../utils/heroIcon';
import { firstEnabledHero, moveHeroCursor, type HeroGridDir } from '../utils/cmHeroGrid';
import { CAPTAINS_SESSION_KEY } from '../utils/submitterToken';
import { attributeLabel } from '../i18n/display';
import RoleAssignment from '../components/RoleAssignment';
import EvaluationPanel from '../components/EvaluationPanel';
import './CaptainsPage.css';

const BattlePanel = lazy(() => import('../components/BattlePanel'));

const ATTR_ORDER = ['str', 'agi', 'int', 'all'] as const;
const SPLASH_MS = 2000;
const SESSION_KEY = CAPTAINS_SESSION_KEY;

function formatMs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function CmTimer({
  endsAt,
  reserveMs,
  acting,
  testId,
}: {
  endsAt: string;
  reserveMs: number;
  acting: boolean;
  testId?: string;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const remainingMs = new Date(endsAt).getTime() - now;
  const stepClock = acting ? Math.max(0, remainingMs) : 0;
  const reserve = acting ? Math.max(0, reserveMs + Math.min(0, remainingMs)) : reserveMs;
  return (
    <>
      <div className="cm-hud-clock" data-testid={testId}>
        {formatMs(stepClock)}
      </div>
      <div className="cm-hud-reserve">
        {t('captains.reserve')} {formatMs(reserve)}
      </div>
    </>
  );
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

function firstEmpty(slots: CmSlot[], type: CmActionType): number {
  return slots.filter((s) => s.type === type).findIndex((s) => s.heroId == null);
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

function BanStrip({ slots, activeIndex }: { slots: CmSlot[]; activeIndex: number }) {
  const bans = slots.filter((s) => s.type === 'ban');
  return (
    <div className="cm-bans">
      {bans.map((slot, i) => (
        <div
          key={`ban-${i}`}
          className={`cm-ban${slot.heroId != null ? ' is-filled' : ''}${i === activeIndex ? ' is-active' : ''}`}
        >
          {slot.heroId != null ? (
            <>
              <img
                src={heroSplashUrl(slot.heroId)}
                alt=""
                width={90}
                height={51}
                loading="lazy"
                draggable={false}
              />
              <span className="cm-ban-x" aria-hidden="true">
                ✕
              </span>
            </>
          ) : (
            <span className="cm-ban-empty" />
          )}
        </div>
      ))}
    </div>
  );
}

function PickColumn({
  slots,
  activeIndex,
  heroes,
}: {
  slots: CmSlot[];
  activeIndex: number;
  heroes: Map<number, Hero>;
}) {
  const picks = slots.filter((s) => s.type === 'pick');
  return (
    <div className="cm-picks">
      {picks.map((slot, i) => {
        const hero = slot.heroId != null ? heroes.get(slot.heroId) : null;
        return (
          <div
            key={`pick-${i}`}
            className={`cm-pick${hero ? ' is-filled' : ''}${i === activeIndex ? ' is-active' : ''}`}
          >
            {hero ? (
              <>
                <img
                  src={heroSplashUrl(hero.id)}
                  alt={hero.name}
                  width={160}
                  height={90}
                  loading="lazy"
                  draggable={false}
                />
                <span className="cm-pick-name">{hero.name}</span>
              </>
            ) : (
              <span className="cm-pick-empty" />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function CaptainsPage() {
  const { t } = useTranslation();
  const [roster, setRoster] = useState<Hero[]>([]);
  const [state, setState] = useState<CaptainsStateView | null>(null);
  const [splash, setSplash] = useState(() => {
    try {
      return !localStorage.getItem(SESSION_KEY);
    } catch {
      return true;
    }
  });
  const [cursorId, setCursorId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
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
    let cancelled = false;
    const persist = (view: CaptainsStateView) => {
      if (view.status === 'COMPLETED') {
        localStorage.removeItem(SESSION_KEY);
      } else {
        localStorage.setItem(SESSION_KEY, view.id);
      }
      if (!cancelled) {
        setState(view);
        setSplash(false);
      }
    };

    const boot = async () => {
      const existing = localStorage.getItem(SESSION_KEY);
      if (existing) {
        try {
          const view = await api.getCaptains(existing);
          if (view.status !== 'COMPLETED') {
            persist(view);
            return;
          }
        } catch {
          /* stale id */
        }
        localStorage.removeItem(SESSION_KEY);
      }
      await new Promise((resolve) => window.setTimeout(resolve, SPLASH_MS));
      if (cancelled) return;
      try {
        persist(await api.startCaptains());
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setSplash(false);
        }
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!state?.draftId) return;
    void api
      .getDraft(state.draftId)
      .then(setPlayerDraft)
      .catch((err) => setError((err as Error).message));
  }, [state?.draftId, state?.status]);

  useEffect(() => {
    if (!state) return;
    if (state.status === 'COMPLETED') localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, state.id);
  }, [state]);

  useEffect(() => {
    if (!state?.aiDraftId) return;
    void api
      .getDraft(state.aiDraftId)
      .then(setAiDraft)
      .catch((err) => setError((err as Error).message));
  }, [state?.aiDraftId]);

  useEffect(() => {
    if (!state || state.acting !== 'player' || busy || state.status !== 'DRAFTING') return;
    const delay = Math.max(0, new Date(state.stepEndsAt).getTime() + state.playerReserveMs - Date.now());
    const id = window.setTimeout(() => {
      setBusy(true);
      void api
        .actCaptains(state.id, null, true)
        .then(setState)
        .catch((err) => setError((err as Error).message))
        .finally(() => setBusy(false));
    }, delay);
    return () => window.clearTimeout(id);
  }, [state, busy]);

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

  const byAttr = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ATTR_ORDER.map((attr) => ({
      attr,
      heroes: roster.filter((h) => h.primary_attribute === attr && h.name.toLowerCase().includes(q)),
    }));
  }, [roster, query]);
  const columns = useMemo(() => byAttr.map((col) => col.heroes.map((h) => h.id)), [byAttr]);
  const enabledHeroes = useMemo(() => {
    const next = new Set<number>();
    for (const col of byAttr) {
      for (const hero of col.heroes) {
        if (!banned.has(hero.id) && !picked.has(hero.id)) next.add(hero.id);
      }
    }
    return next;
  }, [byAttr, banned, picked]);

  useEffect(() => {
    if (cursorId != null && enabledHeroes.has(cursorId)) return;
    setCursorId(firstEnabledHero(columns, enabledHeroes));
  }, [columns, enabledHeroes, cursorId]);

  const canAct = Boolean(state && !busy && state.acting === 'player' && state.status === 'DRAFTING');

  const onHeroGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const dir: HeroGridDir | null =
      event.key === 'ArrowDown'
        ? 'down'
        : event.key === 'ArrowUp'
          ? 'up'
          : event.key === 'ArrowLeft'
            ? 'left'
            : event.key === 'ArrowRight'
              ? 'right'
              : event.key === 'Home'
                ? 'home'
                : event.key === 'End'
                  ? 'end'
                  : null;
    if (!dir) return;
    event.preventDefault();
    const next = moveHeroCursor(columns, enabledHeroes, cursorId, dir);
    if (next == null) return;
    setCursorId(next);
    window.requestAnimationFrame(() => {
      const btn = document.querySelector(`[data-testid="cm-hero-${next}"]`);
      if (btn instanceof HTMLButtonElement) btn.focus();
    });
  };

  const onStageKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    const exit = event.currentTarget.querySelector('.cm-exit');
    if (exit instanceof HTMLElement) exit.focus();
  };
  const step = state?.current;
  const phaseWord = step
    ? step.type === 'ban'
      ? t('captains.banning')
      : t('captains.picking')
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

  if (splash) {
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

  if (!state && !error) {
    return (
      <div className="page captains-page captains-page--splash">
        <p className="cm-splash-note" data-testid="cm-resuming">
          {t('captains.loading')}
        </p>
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
        <div className="cm-stage" data-testid="cm-board" onKeyDown={onStageKeyDown}>
          <header className="cm-hud">
            <div
              className={`cm-hud-side cm-hud-side--radiant${state.acting === 'player' ? ' is-acting' : ''}`}
            >
              <Link to="/" className="wordmark cm-exit" aria-label={t('captains.exit')} viewTransition>
                DotaDraft
              </Link>
              <div className="cm-hud-name">{t('captains.radiant')}</div>
              <CmTimer
                endsAt={state.stepEndsAt}
                reserveMs={state.playerReserveMs}
                acting={state.acting === 'player'}
                testId="cm-step-clock"
              />
            </div>
            <div className="cm-hud-phase">
              <div className="cm-hud-phase-type">{phaseWord}</div>
              <div className="cm-hud-phase-who">{whoWord}</div>
              <SequenceBar currentIndex={state.stepIndex} />
            </div>
            <div className={`cm-hud-side cm-hud-side--dire${state.acting === 'ai' ? ' is-acting' : ''}`}>
              <div className="cm-hud-name">{t('captains.dire')}</div>
              <CmTimer
                endsAt={state.stepEndsAt}
                reserveMs={state.aiReserveMs}
                acting={state.acting === 'ai'}
              />
            </div>
          </header>

          <div className="cm-draft" data-testid="cm-draft">
            <aside className="cm-col cm-col--radiant" data-testid="cm-col-radiant">
              <BanStrip slots={playerSlots} activeIndex={radiantBanActive} />
              <PickColumn slots={playerSlots} activeIndex={radiantPickActive} heroes={heroesById} />
            </aside>

            <div className="cm-pool">
              <div className="cm-attr-grid" data-testid="cm-hero-grid" onKeyDown={onHeroGridKeyDown}>
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
                            disabled={locked}
                            aria-disabled={!canAct || locked}
                            tabIndex={cursorId === hero.id && !locked ? 0 : -1}
                            onFocus={() => {
                              if (!locked) setCursorId(hero.id);
                            }}
                            onClick={() => {
                              if (canAct) void handlePick(hero.id);
                            }}
                            title={hero.name}
                          >
                            <img
                              src={heroIconUrl(hero.id)}
                              alt={hero.name}
                              width={64}
                              height={36}
                              loading="lazy"
                              decoding="async"
                              draggable={false}
                            />
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

            <aside className="cm-col cm-col--dire" data-testid="cm-col-dire">
              <BanStrip slots={aiSlots} activeIndex={direBanActive} />
              <PickColumn slots={aiSlots} activeIndex={direPickActive} heroes={heroesById} />
            </aside>
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
            <Suspense fallback={<p className="captains-note">{t('captains.loading')}</p>}>
              <BattlePanel
                draftId={playerDraft.id}
                heroes={playerDraft.heroes}
                variant="once"
                autoStart
                captainsSessionId={state.id}
                onFought={() => {
                  localStorage.removeItem(SESSION_KEY);
                  void api.getCaptains(state.id).then(setState);
                }}
              />
            </Suspense>
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
