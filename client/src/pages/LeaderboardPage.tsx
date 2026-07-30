import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LeaderboardEntryView } from 'shared';
import { api } from '../api/client';
import { getSubmitterToken } from '../utils/submitterToken';
import './LeaderboardPage.css';

// Blueprint/10-tech-debt-backlog.md, "Лидерборд" — deliberately weak: no
// accounts, ranked by an anonymous localStorage token. Displayed as
// "Player #AB12CD34" (first 8 chars of the UUID, uppercased) rather than
// the raw token — same anonymity, more readable. The viewer's own row
// (matched via getSubmitterToken(), the same token Battle Mode sends) is
// highlighted so a single player can find themselves in the list.
function playerLabel(token: string): string {
  return `#${token.slice(0, 8).toUpperCase()}`;
}

export default function LeaderboardPage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<LeaderboardEntryView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const myToken = getSubmitterToken();

  useEffect(() => {
    api
      .getLeaderboard()
      .then(setEntries)
      .catch((err) => setError((err as Error).message));
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
        <p className="loading-text">{t('draft.loading')}</p>
      </div>
    );
  }

  return (
    <div className="page leaderboard-page">
      <h2>{t('leaderboard.title')}</h2>
      <p className="leaderboard-note">{t('leaderboard.note')}</p>

      {entries.length === 0 ? (
        <p className="empty-text">{t('leaderboard.empty')}</p>
      ) : (
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('leaderboard.player')}</th>
              <th>{t('leaderboard.wins')}</th>
              <th>{t('leaderboard.losses')}</th>
              <th>{t('leaderboard.winRate')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => (
              <tr key={entry.submitterToken} className={entry.submitterToken === myToken ? 'leaderboard-row-me' : undefined}>
                <td>{i + 1}</td>
                <td>{playerLabel(entry.submitterToken)}</td>
                <td>{entry.wins}</td>
                <td>{entry.losses}</td>
                <td>{Math.round(entry.winRate * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
