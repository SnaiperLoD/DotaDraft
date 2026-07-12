import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { HistoryEntry } from '../../../shared/types/draft';

export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getHistory()
      .then(setEntries)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p style={{ color: 'red' }}>{error}</p>;
  if (entries.length === 0) return <p>No completed drafts yet.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {entries.map((entry) => (
        <div key={entry.id} style={{ border: '1px solid #333', padding: 12 }}>
          <div style={{ opacity: 0.7, fontSize: 12 }}>
            {new Date(entry.createdAt).toLocaleString()}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
            {entry.heroes
              .slice()
              .sort((a, b) => a.pickOrder - b.pickOrder)
              .map((h) => (
                <div key={h.heroId} style={{ display: 'flex', gap: 12 }}>
                  <span style={{ width: 24, opacity: 0.6 }}>#{h.pickOrder}</span>
                  <span style={{ width: 140, fontWeight: 'bold' }}>{h.heroName}</span>
                  <span>{h.assignedRole}</span>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
