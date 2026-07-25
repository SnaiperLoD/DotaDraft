import { useState } from 'react';
import { api } from '../api/client';
import type { EvaluationResult } from 'shared';
import type { DraftHeroView } from '../api/types';
import { detectBadges } from '../data/badges';
import BadgeRow from './BadgeRow';
import './EvaluationPanel.css';

interface Props {
  draftId: string;
  heroes: DraftHeroView[];
}

// Same 30/70 split as the server's percentileBracket() (score-narrative.ts)
// — kept in sync by hand since this is purely a display-color decision,
// not scoring logic.
function percentileLabel(percentile: number): string {
  if (percentile < 30) return `Bottom ${Math.max(1, percentile)}%`;
  if (percentile < 70) return `${percentile}th percentile`;
  return `Top ${Math.max(1, 100 - percentile)}%`;
}

function percentileClass(percentile: number): string {
  if (percentile < 30) return 'percentile-low';
  if (percentile < 70) return 'percentile-mid';
  return 'percentile-high';
}

// 5-star rendering of totalScore (0-10) as a faster-to-read companion to
// the raw X/10 number, not a replacement (Blueprint/10-tech-debt-backlog.md,
// "Финальная оценка драфта — 5-звёздочная система"). Supports fractional
// fill (not just whole/half stars) via a clipped overlay — a gold star row
// absolutely positioned over a dim one, clipped to score/10 width.
function StarRating({ score }: { score: number }) {
  const percent = Math.max(0, Math.min(100, (score / 10) * 100));
  return (
    <span className="star-rating" aria-label={`${(score / 2).toFixed(1)} out of 5 stars`}>
      <span className="star-rating-bg" aria-hidden="true">
        ★★★★★
      </span>
      <span className="star-rating-fg" aria-hidden="true" style={{ width: `${percent}%` }}>
        ★★★★★
      </span>
    </span>
  );
}

export default function EvaluationPanel({ draftId, heroes }: Props) {
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEvaluate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getEvaluation(draftId);
      setResult(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!result) {
    return (
      <div className="evaluation-panel">
        <button className="btn btn-primary" onClick={() => void handleEvaluate()} disabled={loading}>
          {loading ? 'Evaluating…' : 'Evaluate Draft'}
        </button>
        {error && <p className="error-text">{error}</p>}
      </div>
    );
  }

  const badges = detectBadges(heroes.map((h) => h.hero));

  return (
    <div className="evaluation-panel">
      <BadgeRow badges={badges} />

      <h3 className="evaluation-title">
        Evaluation — Total Score: <em>{result.totalScore}/10</em>
        <StarRating score={result.totalScore} />
      </h3>

      <p className="evaluation-gameplan">{result.summary.gameplan}</p>

      <div className="evaluation-summary">
        <div className="evaluation-summary-col">
          <div className="evaluation-summary-heading">Strengths</div>
          <ul>
            {result.summary.strengths.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
        <div className="evaluation-summary-col">
          <div className="evaluation-summary-heading">Weaknesses</div>
          <ul>
            {result.summary.weaknesses.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="evaluation-breakdown">
        {result.breakdown.map((item) => (
          <div key={item.key} className="panel evaluation-item">
            <div className="evaluation-item-header">
              <span>{item.label}</span>
              <span className="evaluation-item-scores">
                {item.percentile !== null && (
                  <span className={`percentile-pill ${percentileClass(item.percentile)}`}>
                    {percentileLabel(item.percentile)}
                  </span>
                )}
                <span className="score">{item.score === null ? 'N/A' : `${item.score}/10`}</span>
              </span>
            </div>
            <ul>
              {item.explanation.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            {item.matchUrl && (
              <a
                className="evaluation-match-link"
                href={item.matchUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                View match on OpenDota →
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
