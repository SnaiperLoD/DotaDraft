import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { EvaluationResult } from 'shared';
import type { DraftHeroView } from '../api/types';
import { detectBadges } from '../data/badges';
import BadgeRow from './BadgeRow';
import AxisRadar from './AxisRadar';
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
    `(${[...heroNames]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|')})`,
    'g',
  );
  const parts = text.split(pattern);
  return parts.map((part, i) =>
    heroNames.includes(part) ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>,
  );
}

// English ordinal suffix. The label used to hardcode "th", which read as
// "31th percentile" / "42th percentile" for roughly a fifth of all values.
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

// Same 30/70 split as the server's percentileBracket() (score-narrative.ts)
// — kept in sync by hand since this is purely a display-color decision,
// not scoring logic.
function percentileLabel(percentile: number): string {
  if (percentile < 30) return `Bottom ${Math.max(1, percentile)}%`;
  if (percentile < 70) return `${ordinal(percentile)} percentile`;
  return `Top ${Math.max(1, 100 - percentile)}%`;
}

function percentileClass(percentile: number): string {
  if (percentile < 30) return 'percentile-low';
  if (percentile < 70) return 'percentile-mid';
  return 'percentile-high';
}

// One-word read on the headline number, for the moment before anyone
// parses the decimal. Buckets are even fifths of the 0-10 range, which is
// meaningful because totalScore is percentile-transformed (see
// evaluation.service.ts) rather than clustering around the middle.
function verdictKey(score: number): string {
  if (score < 2) return 'dire';
  if (score < 4) return 'weak';
  if (score < 6) return 'even';
  if (score < 8) return 'strong';
  return 'elite';
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

// Ring gauge for the headline score. The number alone gave no sense of
// where it sat on the scale without reading "/10" and doing the division.
const DIAL_R = 52;
const DIAL_CIRCUMFERENCE = 2 * Math.PI * DIAL_R;

function ScoreDial({ score }: { score: number }) {
  const fraction = Math.max(0, Math.min(1, score / 10));
  return (
    <svg className="score-dial" viewBox="0 0 128 128" aria-hidden="true">
      <circle className="score-dial-track" cx="64" cy="64" r={DIAL_R} />
      <circle
        className="score-dial-fill"
        cx="64"
        cy="64"
        r={DIAL_R}
        strokeDasharray={`${DIAL_CIRCUMFERENCE * fraction} ${DIAL_CIRCUMFERENCE}`}
      />
    </svg>
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

      <div className="plate plate--framed evaluation-hero">
        <div className="evaluation-hero-dial">
          <ScoreDial score={result.totalScore} />
          <span className="evaluation-hero-value">
            {result.totalScore}
            <span className="evaluation-hero-max">/10</span>
          </span>
        </div>
        <div className="evaluation-hero-copy">
          <div className="evaluation-hero-label">{t('evaluation.totalScoreShort')}</div>
          <div className="evaluation-hero-verdict">
            {t(`evaluation.verdict.${verdictKey(result.totalScore)}`)}
          </div>
          <StarRating score={result.totalScore} />
        </div>
      </div>

      <p className="evaluation-gameplan">{boldHeroNames(result.summary.gameplan, heroNames)}</p>
      {result.campStackingNote && (
        <p className="evaluation-note">{boldHeroNames(result.campStackingNote, heroNames)}</p>
      )}

      <div className="evaluation-columns">
        <div className="panel evaluation-radar-panel">
          <AxisRadar breakdown={result.breakdown} />
        </div>

        <div className="evaluation-summary">
          <div className="evaluation-summary-col">
            <div className="evaluation-summary-heading evaluation-summary-heading--good">
              {t('evaluation.strengths')}
            </div>
            <ul>
              {result.summary.strengths.map((line, i) => (
                <li key={i}>{boldHeroNames(line, heroNames)}</li>
              ))}
            </ul>
          </div>
          <div className="evaluation-summary-col">
            <div className="evaluation-summary-heading evaluation-summary-heading--bad">
              {t('evaluation.weaknesses')}
            </div>
            <ul>
              {result.summary.weaknesses.map((line, i) => (
                <li key={i}>{boldHeroNames(line, heroNames)}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

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
                <span className="score">
                  {item.score === null ? t('evaluation.notAvailable') : `${item.score}/10`}
                </span>
              </span>
            </div>

            {/* Where this axis sits against the reference population, as a
                bar rather than only as a pill of words. The notch is the
                median — the eye finds "left or right of centre" faster
                than it parses "42nd percentile". */}
            {item.percentile !== null && (
              <div className={`percentile-bar ${percentileClass(item.percentile)}`}>
                <span className="percentile-bar-fill" style={{ width: `${item.percentile}%` }} />
                <span className="percentile-bar-median" />
              </div>
            )}

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
