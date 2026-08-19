import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CaptainsStateView, CmSlot, Hero } from 'shared';
import { CM_STEPS } from 'shared';
import { api } from '../api/client';
import { heroPortraitUrl } from '../utils/heroIcon';
import './CaptainsPage.css';

function formatMs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function SlotStrip({
  slots,
  type,
  heroes,
}: {
  slots: CmSlot[];
  type: 'ban' | 'pick';
  heroes: Map<number, Hero>;
}) {
  const filtered = slots.filter((s) => s.type === type);
  return (
    <div className={`cm-strip cm-strip--${type}`}>
      {filtered.map((slot, i) => {
        const hero = slot.heroId != null ? heroes.get(slot.heroId) : null;
        return (
          <div key={`${type}-${i}`} className={`cm-slot cm-slot--${type}${hero ? ' is-filled' : ''}`}>
            {hero ? (
              <img src={heroPortraitUrl(hero.id)} alt={hero.name} />
            ) : (
              <span className="cm-slot-empty">{type === 'ban' ? 'B' : i + 1}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function CaptainsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [roster, setRoster] = useState<Hero[]>([]);
  const [state, setState] = useState<CaptainsStateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void api
      .getHeroes()
      .then(setRoster)
      .catch((err) => setError((err as Error).message));
    void api
      .startCaptains()
      .then(setState)
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!state?.draftId) return;
    navigate(`/draft?resume=${state.draftId}`);
  }, [state?.draftId, navigate]);

  useEffect(() => {
    if (!state || state.acting !== 'player' || busy) return;
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
  const taken = useMemo(() => {
    const ids = new Set<number>();
    if (!state) return ids;
    for (const id of [...state.bannedHeroIds, ...state.playerHeroIds, ...state.aiHeroIds]) ids.add(id);
    return ids;
  }, [state]);

  const playerSlots = state?.slots.filter((s) => s.lane === 'first') ?? [];
  const aiSlots = state?.slots.filter((s) => s.lane === 'second') ?? [];
  const remainingMs = state ? new Date(state.stepEndsAt).getTime() - now : 0;
  const stepClock = Math.max(0, remainingMs);
  const reserveShown = state
    ? state.acting === 'player'
      ? Math.max(0, state.playerReserveMs + Math.min(0, remainingMs))
      : state.aiReserveMs
    : 0;

  const handlePick = async (heroId: number) => {
    if (!state || busy || state.acting !== 'player' || taken.has(heroId)) return;
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

  const filtered = roster.filter((h) => h.name.toLowerCase().includes(query.trim().toLowerCase()));
  const step = state?.current;
  const stepLabel = step
    ? t(step.type === 'ban' ? 'captains.banTurn' : 'captains.pickTurn', {
        who: t(state?.acting === 'player' ? 'captains.you' : 'captains.ai'),
        n: String((state?.stepIndex ?? 0) + 1),
        total: String(CM_STEPS.length),
      })
    : t('captains.done');

  if (!state) {
    return (
      <div className="page">
        {error ? <p className="error-text">{error}</p> : <div className="skeleton" style={{ height: 420 }} />}
      </div>
    );
  }

  return (
    <div className="page captains-page">
      <div className="section-head">
        <h2>{t('captains.title')}</h2>
        <div className="rule" />
      </div>
      <p className="captains-note">{t('captains.note')}</p>
      {error && <p className="error-text">{error}</p>}

      <div className="cm-clock">
        <div className="cm-clock-step">{stepLabel}</div>
        <div className="cm-clock-time" data-testid="cm-step-clock">
          {formatMs(stepClock)}
        </div>
        <div className="cm-clock-reserve">
          {t('captains.reserve')}: {formatMs(reserveShown)}
        </div>
      </div>

      <div className="cm-board">
        <aside className="cm-col cm-col--radiant">
          <div className="cm-col-label">{t('captains.radiant')}</div>
          <SlotStrip slots={playerSlots} type="ban" heroes={heroesById} />
          <SlotStrip slots={playerSlots} type="pick" heroes={heroesById} />
        </aside>

        <div className="cm-grid-wrap">
          <input
            className="cm-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('captains.search')}
            aria-label={t('captains.search')}
          />
          <div className="cm-grid">
            {filtered.map((hero) => {
              const locked = taken.has(hero.id);
              return (
                <button
                  key={hero.id}
                  type="button"
                  className={`cm-hero${locked ? ' is-taken' : ''}`}
                  disabled={locked || busy || state.acting !== 'player'}
                  onClick={() => void handlePick(hero.id)}
                  title={hero.name}
                >
                  <img src={heroPortraitUrl(hero.id)} alt={hero.name} />
                  <span>{hero.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="cm-col cm-col--dire">
          <div className="cm-col-label">{t('captains.dire')}</div>
          <SlotStrip slots={aiSlots} type="ban" heroes={heroesById} />
          <SlotStrip slots={aiSlots} type="pick" heroes={heroesById} />
        </aside>
      </div>
    </div>
  );
}
