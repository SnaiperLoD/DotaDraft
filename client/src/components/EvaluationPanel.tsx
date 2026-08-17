import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import type { EvaluationResult } from 'shared';
import type { DraftHeroView } from '../api/types';
import { detectBadges, type ActiveBadge } from '../data/badges';
import BadgeRow from './BadgeRow';
import AxisRadar from './AxisRadar';
import TopContributorHighlight from './TopContributorHighlight';
import { track } from '../telemetry';
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
// absolutely positioned over a dim one, clipped to fillPercent width. The
// width is driven by the reveal progress so the fill grows in step with the
// ring and the counting number; `score` stays the source for the a11y label,
// which always states the final value regardless of animation.
function StarRating({ score, fillPercent }: { score: number; fillPercent: number }) {
  return (
    <span className="star-rating" aria-label={`${(score / 2).toFixed(1)} out of 5 stars`}>
      <span className="star-rating-bg" aria-hidden="true">
        ★★★★★
      </span>
      <span className="star-rating-fg" aria-hidden="true" style={{ width: `${fillPercent}%` }}>
        ★★★★★
      </span>
    </span>
  );
}

// Ring gauge for the headline score. The number alone gave no sense of
// where it sat on the scale without reading "/10" and doing the division.
// `fraction` is already scaled by the reveal progress, so the arc is drawn
// by setting the visible dash length directly (0 → full) rather than by a
// CSS keyframe. The earlier CSS version animated stroke-dashoffset by a fixed
// 120px, which for a short arc slid the arc into place instead of growing it
// from nothing; driving the dash length from the same progress as the number
// keeps arc and number in exact lockstep.
const DIAL_R = 52;
const DIAL_CIRCUMFERENCE = 2 * Math.PI * DIAL_R;

function ScoreDial({ fraction }: { fraction: number }) {
  const shown = Math.max(0, Math.min(1, fraction));
  return (
    <svg className="score-dial" viewBox="0 0 128 128" aria-hidden="true">
      <circle className="score-dial-track" cx="64" cy="64" r={DIAL_R} />
      <circle
        className="score-dial-fill"
        cx="64"
        cy="64"
        r={DIAL_R}
        strokeDasharray={`${DIAL_CIRCUMFERENCE * shown} ${DIAL_CIRCUMFERENCE}`}
      />
    </svg>
  );
}

// One eased 0→1 progress value over `durationMs`, driven by rAF, used to
// reveal the headline score (ring, counting number, star fill from one
// clock so they can't drift). Honours prefers-reduced-motion by starting —
// and staying — at 1, so reduced-motion users get the final state with no
// animation and no counting. Lives in ScoreHeadline, which only mounts once
// the evaluation result arrives, so the reveal fires exactly when the score
// appears rather than while the "Evaluate" button is still showing.
function useReveal(durationMs = 850): number {
  const prefersReduced =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [progress, setProgress] = useState(prefersReduced ? 1 : 0);

  useEffect(() => {
    if (prefersReduced) return;
    let raf = 0;
    const start = performance.now();
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setProgress(easeOutCubic(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [prefersReduced, durationMs]);

  return progress;
}

function ScoreHeadline({
  score,
  archetypeId,
  badges,
}: {
  score: number;
  archetypeId: string | null | undefined;
  badges: ActiveBadge[];
}) {
  const { t } = useTranslation();
  const progress = useReveal();
  const decimals = Number.isInteger(score) ? 0 : 1;
  const shownValue = (score * progress).toFixed(decimals);
  const fraction = Math.max(0, Math.min(1, score / 10)) * progress;
  const starPercent = Math.max(0, Math.min(100, (score / 10) * 100)) * progress;
  const archetypeLabel =
    archetypeId != null ? t(`evaluation.archetype.${archetypeId}`, { defaultValue: '' }) : '';

  return (
    <div className="panel evaluation-hero">
      <div className="evaluation-hero-dial">
        <ScoreDial fraction={fraction} />
        <span className="evaluation-hero-value">
          {shownValue}
          <span className="evaluation-hero-max">/10</span>
        </span>
      </div>
      <div className="evaluation-hero-copy">
        <div className="evaluation-hero-label">{t('evaluation.totalScoreShort')}</div>
        <div className="evaluation-hero-verdict">{t(`evaluation.verdict.${verdictKey(score)}`)}</div>
        {archetypeLabel ? (
          <div className="evaluation-archetype-seal" title={t(`evaluation.archetypeHint.${archetypeId}`)}>
            <span className="evaluation-archetype-seal-ring" aria-hidden="true" />
            <span className="evaluation-archetype-seal-label">{archetypeLabel}</span>
          </div>
        ) : null}
        <StarRating score={score} fillPercent={starPercent} />
      </div>
      <BadgeRow badges={badges} />
    </div>
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
      track(
        'evaluate_success',
        { totalScore: res.totalScore, archetype: res.archetype?.id ?? null },
        draftId,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!result) {
    return (
      <div className="evaluation-panel">
        <button
          className="btn btn-primary"
          data-testid="evaluate-draft"
          onClick={() => void handleEvaluate()}
          disabled={loading}
        >
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
    <div className="evaluation-panel" data-testid="evaluation-result">
      <ScoreHeadline score={result.totalScore} archetypeId={result.archetype?.id} badges={badges} />

      <p className="evaluation-gameplan bracketed">{boldHeroNames(result.summary.gameplan, heroNames)}</p>

      <div className="evaluation-columns">
        <div className="panel bracketed evaluation-radar-panel">
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
        <div className="panel bracketed evaluation-combos">
          <div className="evaluation-combos-heading">{t('evaluation.activeCombos')}</div>
          <p className="evaluation-combos-note">{t('evaluation.combosBattleNote')}</p>
          <ul>
            {result.customTags.map((tag) => (
              <li key={tag.name}>
                <span className={`hero-tag-badge rarity-${tag.rarity}`}>{tag.name}</span>
                <span className="evaluation-combos-description">{tag.description}</span>
              </li>
            ))}
          </ul>
          <p className="evaluation-combos-footnote">{t('evaluation.combosBattleSummary')}</p>
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
