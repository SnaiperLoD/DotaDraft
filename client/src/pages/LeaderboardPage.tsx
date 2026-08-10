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

  const head = (
    <div className="section-head">
      <h2>{t('leaderboard.title')}</h2>
      <div className="rule" />
    </div>
  );

  if (error) {
    return (
      <div className="page">
        <p className="error-text">{error}</p>
      </div>
    );
  }

  if (!entries) {
    return (
      <div className="page leaderboard-page">
        {head}
        <p className="leaderboard-note">{t('leaderboard.note')}</p>
        <div className="skeleton leaderboard-skeleton" />
      </div>
    );
  }

  return (
    <div className="page leaderboard-page">
      {head}
      <p className="leaderboard-note">{t('leaderboard.note')}</p>

      {entries.length === 0 ? (
        <p className="empty-text">{t('leaderboard.empty')}</p>
      ) : (
        <div className="leaderboard-scroll">
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th className="col-rank">#</th>
                <th>{t('leaderboard.draft')}</th>
                <th className="col-num">{t('leaderboard.evaluation')}</th>
                <th className="col-num">{t('leaderboard.wins')}</th>
                <th className="col-num">{t('leaderboard.losses')}</th>
                <th className="col-rate">{t('leaderboard.winRate')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <tr
                  key={entry.id}
                  className={entry.submitterToken === myToken ? 'leaderboard-row-me' : undefined}
                >
                  {/* Top three get a medal disc instead of a bare number —
                      a leaderboard whose first rows look identical to its
                      fortieth isn't doing its one job. */}
                  <td className="col-rank">
                    <span className={`leaderboard-rank${i < 3 ? ` is-medal is-medal-${i + 1}` : ''}`}>
                      {i + 1}
                    </span>
                  </td>
                  <td>
                    <div className="leaderboard-draft-cell">
                      <div className="leaderboard-draft-icons">
                        {entry.heroIds.map((heroId) => (
                          <img key={heroId} src={heroIconUrl(heroId)} alt="" width={26} height={26} />
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
                  <td className="col-num">
                    {entry.evaluationScore !== null
                      ? `${entry.evaluationScore}/10`
                      : t('evaluation.notAvailable')}
                  </td>
                  <td className="col-num leaderboard-wins">{entry.wins}</td>
                  <td className="col-num leaderboard-losses">{entry.losses}</td>
                  <td className="col-rate">
                    <div className="leaderboard-rate">
                      <span className="leaderboard-rate-value">{Math.round(entry.winRate * 100)}%</span>
                      <span className="leaderboard-rate-track">
                        <span
                          className="leaderboard-rate-fill"
                          style={{ width: `${Math.round(entry.winRate * 100)}%` }}
                        />
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
