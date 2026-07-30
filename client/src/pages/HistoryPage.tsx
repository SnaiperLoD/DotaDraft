import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { HistoryEntry, ConfidenceTier } from 'shared';
import './HistoryPage.css';

export default function HistoryPage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
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

  if (entries.length === 0) {
    return (
      <div className="page">
        <p className="empty-text">{t('history.empty')}</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h2>{t('history.title')}</h2>
      <div className="history-list">
        {entries.map((entry) => (
          <div key={entry.id} className="panel history-entry">
            <div className="history-date">{new Date(entry.createdAt).toLocaleString()}</div>
            <div className="history-heroes">
              {entry.heroes
                .slice()
                .sort((a, b) => a.pickOrder - b.pickOrder)
                .map((h) => (
                  <div key={h.heroId} className="history-hero-row">
                    <span className="index">#{h.pickOrder}</span>
                    <span className="name">{h.heroName}</span>
                    <span className="role">{h.assignedRole ? t(`roles.${h.assignedRole}`) : ''}</span>
                  </div>
                ))}
            </div>

            {entry.evaluation ? (
              <div className="history-evaluation">
                <span className="history-evaluation-score">
                  {t('history.evaluationScore', { score: entry.evaluation.totalScore })}
                </span>
                <span className="history-evaluation-gameplan">{entry.evaluation.summary.gameplan}</span>
              </div>
            ) : (
              <p className="history-evaluation-empty">{t('history.notEvaluated')}</p>
            )}

            {entry.battles.length > 0 && (
              <details className="history-battles">
                <summary>{t('history.battleCount', { count: entry.battles.length })}</summary>
                <ul>
                  {entry.battles.map((b) => (
                    <li key={b.id} className={`history-battle-row history-battle-${b.resolvedOutcome.toLowerCase()}`}>
                      <span className="history-battle-outcome">
                        {b.resolvedOutcome === 'Win' ? t('battle.victory') : t('battle.defeat')}
                      </span>
                      <span className="history-battle-confidence">
                        {t('history.confidenceLower', { tier: t(`battle.tier.${b.confidenceTier as ConfidenceTier}`) })}
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
          </div>
        ))}
      </div>
    </div>
  );
}
