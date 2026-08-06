import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { EvaluationResult } from 'shared';
import type { DraftHeroView } from '../api/types';
import { detectBadges } from '../data/badges';
import BadgeRow from './BadgeRow';
import TopContributorHighlight from './TopContributorHighlight';
import './EvaluationPanel.css';

interface Props {
  draftId: string;
  heroes: DraftHeroView[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Server narrative is plain English prose (Blueprint's i18n scoping —
// server-side text isn't translated/marked-up, see score-narrative.ts) —
// this finds hero names client-side rather than needing the server to
// return structured segments. Scoped to just this draft's 5 heroes (not
// the full 127-hero roster): every narrative sentence in Evaluation talks
// about "this team," never an opponent, so that's the complete set of
// names that could appear. Longest-first in the alternation so e.g. a
// hypothetical "Storm" wouldn't shadow "Storm Spirit" (no such collision
// exists in the current roster, but the ordering costs nothing and avoids
// relying on that staying true).
function boldHeroNames(text: string, heroNames: string[]) {
  if (heroNames.length === 0) return text;
  const pattern = new RegExp(
    `(${[...heroNames].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')})`,
    'g',
  );
  const parts = text.split(pattern);
  return parts.map((part, i) => (heroNames.includes(part) ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>));
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
  const { t } = useTranslation();
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
          {loading && <span className="btn-spinner" aria-hidden="true" />}
          {loading ? t('evaluation.evaluating') : t('evaluation.evaluateDraft')}
        </button>
        {error && <p className="error-text">{error}</p>}
      </div>
    );
  }

  const badges = detectBadges(heroes.map((h) => h.hero));
  const heroNames = heroes.map((h) => h.hero.name);

  return (
    <div className="evaluation-panel">
      <BadgeRow badges={badges} />

      <h3 className="evaluation-title">
        {t('evaluation.totalScore')} <em>{result.totalScore}/10</em>
        <StarRating score={result.totalScore} />
      </h3>

      <p className="evaluation-gameplan">{boldHeroNames(result.summary.gameplan, heroNames)}</p>
      {result.campStackingNote && <p className="evaluation-note">{boldHeroNames(result.campStackingNote, heroNames)}</p>}

      <TopContributorHighlight breakdown={result.breakdown} heroes={heroes} />

      {result.customTags.length > 0 && (
        <div className="panel evaluation-combos">
          <div className="evaluation-combos-heading">{t('evaluation.activeCombos')}</div>
          <ul>
            {result.customTags.map((tag) => (
              <li key={tag.name}>
                <span className={`hero-tag-badge rarity-${tag.rarity}`}>{tag.name}</span>
                <span className="evaluation-combos-description">{tag.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="evaluation-summary">
        <div className="evaluation-summary-col">
          <div className="evaluation-summary-heading">{t('evaluation.strengths')}</div>
          <ul>
            {result.summary.strengths.map((line, i) => (
              <li key={i}>{boldHeroNames(line, heroNames)}</li>
            ))}
          </ul>
        </div>
        <div className="evaluation-summary-col">
          <div className="evaluation-summary-heading">{t('evaluation.weaknesses')}</div>
          <ul>
            {result.summary.weaknesses.map((line, i) => (
              <li key={i}>{boldHeroNames(line, heroNames)}</li>
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
                <span className="score">{item.score === null ? t('evaluation.notAvailable') : `${item.score}/10`}</span>
              </span>
            </div>
            <ul>
              {item.explanation.map((line, i) => (
                <li key={i}>{boldHeroNames(line, heroNames)}</li>
              ))}
            </ul>
            {item.matchUrl && (
              <a
                className="evaluation-match-link"
                href={item.matchUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('evaluation.viewMatch')}
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
