import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { HistoryEntry, ConfidenceTier } from 'shared';
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
                        {entry.ti.leagueName} · {entry.ti.teamName} ·{' '}
                        {t(
                          entry.ti.status === 'CHAMPION'
                            ? 'history.tiChampion'
                            : entry.ti.status === 'ELIMINATED'
                              ? 'history.tiEliminated'
                              : 'history.tiPlaying',
                        )}
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
