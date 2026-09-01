import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { api } from '../api/client';
import type { HistoryEntry, ConfidenceTier, HistoryTiSummary, TiPlacementKind } from 'shared';
import { heroIconUrl } from '../utils/heroIcon';
import { renderLocalizedLines } from '../i18n/narrative';
import { currentWinStreakNewestFirst, runRecord, type FightOutcome } from '../utils/runStreak';
import CopyDraftButton from '../components/CopyDraftButton';
import './HistoryPage.css';

// Colors the score chip on the same 0-10 scale Evaluation's verdict uses.
function scoreClass(score: number): string {
  if (score < 4) return 'is-low';
  if (score < 7) return 'is-mid';
  return 'is-high';
}

const TI_PLACEMENT_KEYS: Record<TiPlacementKind, string> = {
  playing: 'history.tiPlaying',
  champion: 'history.tiChampion',
  second: 'history.tiSecond',
  third: 'history.tiThird',
  fourth: 'history.tiFourth',
  top4: 'history.tiTop4',
  top8: 'history.tiTop8',
  round: 'history.tiRound',
};

function tiPlacementCopy(t: TFunction, ti: HistoryTiSummary): string {
  if (ti.placement === 'round') {
    return t('history.tiRound', { round: ti.lastRound ?? '—' });
  }
  return t(TI_PLACEMENT_KEYS[ti.placement] ?? 'history.tiPlaying');
}

function HistoryChampionTrophy({ label }: { label: string }) {
  return (
    <span
      className="history-ti-trophy"
      title={label}
      aria-label={label}
      role="img"
      data-testid="history-ti-trophy"
    >
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
        <path
          d="M3.2 2.2h9.6v1.4c0 2.7-2.15 4.9-4.8 4.9S3.2 6.3 3.2 3.6V2.2Z"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinejoin="round"
        />
        <path
          d="M3.2 3.4H2.1A2.1 2.1 0 0 0 4.2 5.5"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
        />
        <path
          d="M12.8 3.4h1.1A2.1 2.1 0 0 1 11.8 5.5"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
        />
        <path d="M8 8.5v2.2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        <path d="M5.6 12.4h4.8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        <path d="M4.8 14.2h6.4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function battleOutcomes(entry: HistoryEntry): FightOutcome[] {
  return entry.battles
    .map((b) => b.resolvedOutcome)
    .filter((o): o is FightOutcome => o === 'Win' || o === 'Lose');
}

export default function HistoryPage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'battle' | 'captains' | 'ti'>('all');

  useEffect(() => {
    api
      .getHistory()
      .then(setEntries)
      .catch((err) => setError(err.message));
  }, []);

  const visible = useMemo(() => {
    if (!entries) return [];
    if (filter === 'all') return entries;
    return entries.filter((e) => e.mode === filter);
  }, [entries, filter]);

  if (error) {
    return (
      <div className="page">
        <p className="error-text">{error}</p>
      </div>
    );
  }

  if (!entries) {
    return (
      <div className="page">
        <div className="section-head">
          <h2>{t('history.title')}</h2>
          <div className="rule" />
        </div>
        <div className="history-list">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="skeleton history-skeleton" />
          ))}
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="page">
        <div className="section-head">
          <h2>{t('history.title')}</h2>
          <div className="rule" />
        </div>
        <p className="empty-text">{t('history.empty')}</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="section-head">
        <h2>{t('history.title')}</h2>
        <div className="rule" />
        <span className="history-count">{t('history.draftCount', { count: entries.length })}</span>
      </div>

      <div className="history-filters" role="tablist" aria-label={t('history.title')}>
        {(['all', 'battle', 'captains', 'ti'] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={`history-filter${filter === key ? ' is-active' : ''}`}
            onClick={() => setFilter(key)}
          >
            {t(
              key === 'all'
                ? 'history.filterAll'
                : key === 'battle'
                  ? 'history.filterBattle'
                  : key === 'captains'
                    ? 'history.filterCaptains'
                    : 'history.filterTi',
            )}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="empty-text">{t('history.emptyFilter')}</p>
      ) : (
        <div className="history-list">
          {visible.map((entry) => {
            const outcomes = battleOutcomes(entry);
            const { wins, losses } = runRecord(outcomes);
            // History battles arrive newest-first from the API.
            const winStreak = currentWinStreakNewestFirst(outcomes);
            const archetypeId = entry.evaluation?.archetype?.id;
            const archetypeLabel =
              archetypeId != null ? t(`evaluation.archetype.${archetypeId}`, { defaultValue: '' }) : '';

            return (
              <article key={entry.id} className="panel bracketed history-entry motion-reveal">
                <div className="history-entry-top">
                  <ol className="history-roster">
                    {entry.heroes
                      .slice()
                      .sort((a, b) => a.pickOrder - b.pickOrder)
                      .map((h) => (
                        <li key={h.heroId} className="history-roster-hero">
                          <img src={heroIconUrl(h.heroId)} alt="" width={38} height={38} />
                          <span className="history-roster-name">{h.heroName}</span>
                          <span className="history-roster-role">
                            {h.assignedRole ? t(`roles.${h.assignedRole}`) : '—'}
                          </span>
                        </li>
                      ))}
                  </ol>
                  {entry.mode === 'captains' && (entry.battles[0]?.opponentHeroIds?.length ?? 0) > 0 && (
                    <ol className="history-roster history-roster--opp">
                      {entry.battles[0].opponentHeroIds.map((heroId) => (
                        <li key={heroId} className="history-roster-hero">
                          <img src={heroIconUrl(heroId)} alt="" width={38} height={38} />
                          <span className="history-roster-role">{t('history.theirLineup')}</span>
                        </li>
                      ))}
                    </ol>
                  )}

                  <div className="history-entry-meta">
                    <span className={`history-mode history-mode--${entry.mode}`}>
                      {t(
                        entry.mode === 'captains'
                          ? 'history.modeCaptains'
                          : entry.mode === 'ti'
                            ? 'history.modeTi'
                            : 'history.modeBattle',
                      )}
                    </span>
                    {entry.ti && (
                      <span className="history-ti-status">
                        {entry.ti.placement === 'champion' && (
                          <HistoryChampionTrophy label={t('history.tiChampion')} />
                        )}
                        {entry.ti.leagueName} · {entry.ti.teamName} ·{' '}
                        <span
                          className={`history-ti-placement${entry.ti.placement === 'champion' ? ' is-champion' : ''}`}
                          data-testid="history-ti-placement"
                          data-placement={entry.ti.placement}
                        >
                          {tiPlacementCopy(t, entry.ti)}
                        </span>
                      </span>
                    )}
                    {entry.evaluation ? (
                      <span className={`history-score ${scoreClass(entry.evaluation.totalScore)}`}>
                        {entry.evaluation.totalScore}
                        <span className="history-score-max">/10</span>
                      </span>
                    ) : (
                      <span className="history-score is-none">{t('evaluation.notAvailable')}</span>
                    )}

                    {archetypeLabel ? (
                      <span
                        className="history-archetype"
                        title={t(`evaluation.archetypeHint.${archetypeId}`)}
                      >
                        {archetypeLabel}
                      </span>
                    ) : null}

                    {entry.battles.length > 0 && (
                      <span className="history-record">
                        <span className="history-record-win">
                          {wins}
                          {t('history.winShort')}
                        </span>
                        <span className="history-record-sep">·</span>
                        <span className="history-record-lose">
                          {losses}
                          {t('history.lossShort')}
                        </span>
                        {winStreak >= 2 && (
                          <>
                            <span className="history-record-sep">·</span>
                            <span className="history-streak">
                              {t('history.winStreak', { count: winStreak })}
                            </span>
                          </>
                        )}
                      </span>
                    )}

                    <span className="history-date">{new Date(entry.createdAt).toLocaleString()}</span>

                    <CopyDraftButton
                      compact
                      heroes={entry.heroes.map((h) => ({
                        heroId: h.heroId,
                        heroName: h.heroName,
                        assignedRole: h.assignedRole,
                        pickOrder: h.pickOrder,
                      }))}
                    />
                  </div>
                </div>

                {entry.evaluation ? (
                  <p className="history-evaluation-gameplan">
                    {renderLocalizedLines(t, entry.evaluation.summary.gameplan)}
                  </p>
                ) : (
                  <p className="history-evaluation-empty">{t('history.notEvaluated')}</p>
                )}

                {entry.battles.length > 0 && (
                  <details className="history-battles">
                    <summary>{t('history.battleCount', { count: entry.battles.length })}</summary>
                    <ul>
                      {entry.battles.map((b) => (
                        <li
                          key={b.id}
                          className={`history-battle-row history-battle-${b.resolvedOutcome.toLowerCase()}`}
                        >
                          <span className="history-battle-outcome">
                            {b.resolvedOutcome === 'Win' ? t('battle.victory') : t('battle.defeat')}
                          </span>
                          <span className="history-battle-confidence">
                            {t('history.confidenceLower', {
                              tier: t(`battle.tier.${b.confidenceTier as ConfidenceTier}`),
                            })}
                          </span>
                          <span className="history-battle-opponent">
                            {t('battle.vs')}{' '}
                            {b.opponentTeamName
                              ? `${b.opponentTeamName}${b.opponentLeagueName ? ` (${b.opponentLeagueName})` : ''}`
                              : b.opponentSource === 'pro'
                                ? t('battle.proDraft')
                                : t('battle.anotherPlayer')}
                          </span>
                          <span className="history-battle-date">
                            {new Date(b.createdAt).toLocaleString()}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
