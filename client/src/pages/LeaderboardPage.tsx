import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LeaderboardEntryView } from 'shared';
import { api } from '../api/client';
import { getSubmitterToken } from '../utils/submitterToken';
import { heroIconUrl } from '../utils/heroIcon';
import './LeaderboardPage.css';

// Blueprint/10-tech-debt-backlog.md, "Лидерборд драфтов" — deliberately
// weak: no accounts, ranked by wins as the OPPONENT when other players'
// battles pull this committed draft (not the committing player's own
// battle record — that isn't tracked at all). A row the viewer's own
// browser committed (matched via getSubmitterToken()) is highlighted.
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
              <th>{t('leaderboard.draft')}</th>
              <th>{t('leaderboard.evaluation')}</th>
              <th>{t('leaderboard.wins')}</th>
              <th>{t('leaderboard.losses')}</th>
              <th>{t('leaderboard.winRate')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => (
              <tr key={entry.id} className={entry.submitterToken === myToken ? 'leaderboard-row-me' : undefined}>
                <td>{i + 1}</td>
                <td>
                  <div className="leaderboard-draft-cell">
                    <div className="leaderboard-draft-icons">
                      {entry.heroIds.map((heroId) => (
                        <img key={heroId} src={heroIconUrl(heroId)} alt="" width={24} height={24} />
                      ))}
                    </div>
                    {entry.source === 'pro' && entry.teamName && (
                      <span className="leaderboard-team-name">
                        {entry.teamName}
                        {entry.leagueName ? ` (${entry.leagueName})` : ''}
                      </span>
                    )}
                  </div>
                </td>
                <td>{entry.evaluationScore !== null ? `${entry.evaluationScore}/10` : t('evaluation.notAvailable')}</td>
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
