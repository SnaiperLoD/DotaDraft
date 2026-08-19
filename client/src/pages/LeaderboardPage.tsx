import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LeaderboardResponse, RunLeaderboardEntry } from 'shared';
import { api } from '../api/client';
import { heroIconUrl } from '../utils/heroIcon';
import './LeaderboardPage.css';

// Three-part leaderboard (playtest 2026-08-19): All Runs (global qualifying
// Battle runs), My Runs (this browser's ownerToken), Pool Opponents (committed
// drafts ranked as the opponent other players pull). No accounts; own rows
// are highlighted via server-computed `isMine`. Assumption: keep the pool
// board — it measures a different loop than all-runs.

interface Row {
  key: string;
  heroIds: number[];
  evaluationScore: number | null;
  wins: number;
  losses: number;
  winRate: number;
  teamName?: string | null;
  leagueName?: string | null;
  isMine?: boolean;
}

function LeaderboardTable({ rows }: { rows: Row[] }) {
  const { t } = useTranslation();
  return (
    <div className="leaderboard-scroll">
      <table className="leaderboard-table" data-testid="leaderboard-table">
        <thead>
          <tr>
            <th className="col-rank">#</th>
            <th className="col-draft">{t('leaderboard.draft')}</th>
            <th className="col-num col-eval">{t('leaderboard.evaluation')}</th>
            <th className="col-num col-wins">{t('leaderboard.wins')}</th>
            <th className="col-num col-losses">{t('leaderboard.losses')}</th>
            <th className="col-rate">{t('leaderboard.winRate')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.key} className={row.isMine ? 'leaderboard-row-me' : undefined}>
              <td className="col-rank">
                <span className={`leaderboard-rank${i < 3 ? ` is-medal is-medal-${i + 1}` : ''}`}>
                  {i + 1}
                </span>
              </td>
              <td className="col-draft">
                <div className="leaderboard-draft-cell">
                  <div className="leaderboard-draft-icons">
                    {row.heroIds.map((heroId) => (
                      <img key={heroId} src={heroIconUrl(heroId)} alt="" width={26} height={26} />
                    ))}
                  </div>
                  {row.teamName && (
                    <span className="leaderboard-team-name">
                      {row.teamName}
                      {row.leagueName ? ` (${row.leagueName})` : ''}
                    </span>
                  )}
                </div>
              </td>
              <td className="col-num col-eval" data-label={t('leaderboard.evaluation')}>
                {row.evaluationScore !== null ? `${row.evaluationScore}/10` : t('evaluation.notAvailable')}
              </td>
              <td className="col-num col-wins leaderboard-wins" data-label={t('leaderboard.wins')}>
                {row.wins}
              </td>
              <td className="col-num col-losses leaderboard-losses" data-label={t('leaderboard.losses')}>
                {row.losses}
              </td>
              <td className="col-rate" data-label={t('leaderboard.winRate')}>
                <div className="leaderboard-rate">
                  <span className="leaderboard-rate-value">{Math.round(row.winRate * 100)}%</span>
                  <span className="leaderboard-rate-track">
                    <span
                      className="leaderboard-rate-fill"
                      style={{ width: `${Math.round(row.winRate * 100)}%` }}
                    />
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function runRows(runs: RunLeaderboardEntry[]): Row[] {
  return runs.map((r) => ({
    key: r.draftId,
    heroIds: r.heroIds,
    evaluationScore: r.evaluationScore,
    wins: r.wins,
    losses: r.losses,
    winRate: r.winRate,
    isMine: r.isMine,
  }));
}

export default function LeaderboardPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getLeaderboard()
      .then(setData)
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

  if (!data) {
    return (
      <div className="page leaderboard-page">
        {head}
        <div className="skeleton leaderboard-skeleton" />
      </div>
    );
  }

  const poolRows: Row[] = data.pool.map((p) => ({
    key: p.id,
    heroIds: p.heroIds,
    evaluationScore: p.evaluationScore,
    wins: p.wins,
    losses: p.losses,
    winRate: p.winRate,
    teamName: p.source === 'pro' ? p.teamName : null,
    leagueName: p.source === 'pro' ? p.leagueName : null,
    isMine: p.isMine,
  }));

  return (
    <div className="page leaderboard-page">
      {head}

      <section className="leaderboard-section">
        <h3 className="leaderboard-subtitle">{t('leaderboard.globalTitle')}</h3>
        <p className="leaderboard-note">{t('leaderboard.globalNote')}</p>
        {data.globalRuns.length === 0 ? (
          <p className="empty-text">{t('leaderboard.globalEmpty')}</p>
        ) : (
          <LeaderboardTable rows={runRows(data.globalRuns)} />
        )}
      </section>

      <section className="leaderboard-section">
        <h3 className="leaderboard-subtitle">{t('leaderboard.runsTitle')}</h3>
        <p className="leaderboard-note">{t('leaderboard.runsNote')}</p>
        {data.runs.length === 0 ? (
          <p className="empty-text">{t('leaderboard.runsEmpty')}</p>
        ) : (
          <LeaderboardTable rows={runRows(data.runs)} />
        )}
      </section>

      <section className="leaderboard-section">
        <h3 className="leaderboard-subtitle">{t('leaderboard.poolTitle')}</h3>
        <p className="leaderboard-note">{t('leaderboard.note')}</p>
        {poolRows.length === 0 ? (
          <p className="empty-text">{t('leaderboard.empty')}</p>
        ) : (
          <LeaderboardTable rows={poolRows} />
        )}
      </section>
    </div>
  );
}
