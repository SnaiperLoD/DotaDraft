import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { HistoryEntry } from 'shared';
import './HistoryPage.css';

export default function HistoryPage() {
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
        <p className="empty-text">No completed drafts yet.</p>
      </div>
    );
  }

  return (
    <div className="page">
      <h2>History</h2>
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
                    <span className="role">{h.assignedRole}</span>
                  </div>
                ))}
            </div>

            {entry.evaluation ? (
              <div className="history-evaluation">
                <span className="history-evaluation-score">Evaluation: {entry.evaluation.totalScore}/10</span>
                <span className="history-evaluation-gameplan">{entry.evaluation.summary.gameplan}</span>
              </div>
            ) : (
              <p className="history-evaluation-empty">Not evaluated.</p>
            )}

            {entry.battles.length > 0 && (
              <details className="history-battles">
                <summary>
                  {entry.battles.length} {entry.battles.length === 1 ? 'battle' : 'battles'}
                </summary>
                <ul>
                  {entry.battles.map((b) => (
                    <li key={b.id} className={`history-battle-row history-battle-${b.resolvedOutcome.toLowerCase()}`}>
                      <span className="history-battle-outcome">
                        {b.resolvedOutcome === 'Win' ? 'Victory' : 'Defeat'}
                      </span>
                      <span className="history-battle-confidence">{b.confidenceTier} confidence</span>
                      <span className="history-battle-opponent">
                        vs.{' '}
                        {b.opponentTeamName
                          ? `${b.opponentTeamName}${b.opponentLeagueName ? ` (${b.opponentLeagueName})` : ''}`
                          : b.opponentSource === 'pro'
                            ? 'a professional draft'
                            : 'another player'}
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
