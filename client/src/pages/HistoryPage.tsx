import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { HistoryEntry, ConfidenceTier } from 'shared';
import { heroIconUrl } from '../utils/heroIcon';
import './HistoryPage.css';

// Colors the score chip on the same 0-10 scale Evaluation's verdict uses.
function scoreClass(score: number): string {
  if (score < 4) return 'is-low';
  if (score < 7) return 'is-mid';
  return 'is-high';
}

export default function HistoryPage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getHistory()
      .then(setEntries)
      .catch((err) => setError(err.message));
  }, []);

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

      <div className="history-list">
        {entries.map((entry) => {
          const wins = entry.battles.filter((b) => b.resolvedOutcome === 'Win').length;
          const losses = entry.battles.length - wins;
          return (
            <article key={entry.id} className="panel history-entry">
              {/* The roster was five text rows before — the same five heroes
                  as a strip of portraits is both smaller and recognisable
                  without reading, which is what a history list is for. */}
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

                <div className="history-entry-meta">
                  {entry.evaluation ? (
                    <span className={`history-score ${scoreClass(entry.evaluation.totalScore)}`}>
                      {entry.evaluation.totalScore}
                      <span className="history-score-max">/10</span>
                    </span>
                  ) : (
                    <span className="history-score is-none">{t('evaluation.notAvailable')}</span>
                  )}

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
                    </span>
                  )}

                  <span className="history-date">{new Date(entry.createdAt).toLocaleString()}</span>
                </div>
              </div>

              {entry.evaluation ? (
                <p className="history-evaluation-gameplan">{entry.evaluation.summary.gameplan}</p>
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
                        <span className="history-battle-date">{new Date(b.createdAt).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
