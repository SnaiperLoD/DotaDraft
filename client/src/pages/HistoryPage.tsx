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
          </div>
        ))}
      </div>
    </div>
  );
}
