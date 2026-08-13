import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnalyzerResult } from 'shared';
import './AxisRadar.css';

// The "draft fingerprint" — every axis with a percentile, plotted on one
// polygon. Evaluation used to present twelve axes only as a vertical stack
// of cards, so the shape of a draft (spiky vs. round, front-loaded vs.
// late) was something you had to reconstruct by reading fifteen numbers.
//
// Radius is the PERCENTILE, not the 0-10 score: scores cluster in the
// 3.5-5.7 band for most drafts (see this file's callers — that clustering
// is exactly why the total score got a percentile transform), which would
// draw every team as the same near-circle. Percentiles are already
// rank-spread against 10,000 random teams, so they fill the chart.
interface Props {
  breakdown: AnalyzerResult[];
}

const SIZE = 320;
const CENTER = SIZE / 2;
const MAX_R = 100;
const RINGS = [25, 50, 75, 100];
// Labels sit outside the outermost ring, expressed on the same 0-100
// percentile scale the geometry uses.
const LABEL_PCT = 122;
// SVG user units — line spacing for two-line labels, sized to the larger
// label font (AxisRadar.css) so stacked words don't crowd.
const LINE_H = 12;

function pointAt(index: number, count: number, radiusPct: number): [number, number] {
  // Start at 12 o'clock and go clockwise.
  const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
  const r = (Math.max(0, Math.min(100, radiusPct)) / 100) * MAX_R;
  return [CENTER + Math.cos(angle) * r, CENTER + Math.sin(angle) * r];
}

export default function AxisRadar({ breakdown }: Props) {
  const { t } = useTranslation();
  const [active, setActive] = useState<number | null>(null);
  // Non-axis analyzers (Synergy, Counter, Pro Similarity) carry percentile
  // null — they aren't comparable on this scale and would distort the shape.
  const axes = breakdown.filter((b) => b.percentile !== null);
  if (axes.length < 3) return null;

  const count = axes.length;
  const polygon = axes.map((a, i) => pointAt(i, count, a.percentile!).join(',')).join(' ');

  return (
    <figure className="axis-radar">
      <figcaption className="axis-radar-caption">{t('evaluation.radarTitle')}</figcaption>
      <div className="axis-radar-plot">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="axis-radar-svg"
          role="img"
          aria-label={t('evaluation.radarAlt')}
        >
          {RINGS.map((ring) => (
            <polygon
              key={ring}
              className={`axis-radar-ring${ring === 50 ? ' axis-radar-ring--median' : ''}`}
              points={axes.map((_, i) => pointAt(i, count, ring).join(',')).join(' ')}
            />
          ))}

          {axes.map((axis, i) => {
            const [x, y] = pointAt(i, count, 100);
            return (
              <line
                key={axis.key}
                className={`axis-radar-spoke${i === active ? ' is-active' : ''}`}
                x1={CENTER}
                y1={CENTER}
                x2={x}
                y2={y}
              />
            );
          })}

          <polygon className="axis-radar-shape" points={polygon} />

          {/* Dots are purely visual — the interaction lives on the HTML
            hotspots below the SVG, not here. */}
          {axes.map((axis, i) => {
            const [x, y] = pointAt(i, count, axis.percentile!);
            return (
              <circle
                key={axis.key}
                className={`axis-radar-dot${i === active ? ' is-active' : ''}`}
                cx={x}
                cy={y}
                r={3}
              />
            );
          })}

          {axes.map((axis, i) => {
            const [x, y] = pointAt(i, count, LABEL_PCT);
            // Anchor by which half of the circle the label sits in, so text
            // grows away from the chart instead of over it.
            const anchor = x < CENTER - 4 ? 'end' : x > CENTER + 4 ? 'start' : 'middle';
            // Long labels ("Resource Efficiency", "Damage Output") get a
            // second line rather than running into their neighbours.
            const words = axis.label.split(' ');
            // Vertical placement has to follow which part of the circle the
            // label sits on. A two-line label at 12 o'clock anchored on its
            // first line hangs down into the chart and collides with the
            // polygon's own top vertex, which is exactly where the shape is
            // busiest — so top labels stack upward, bottom labels downward,
            // and side labels centre on the spoke.
            const lines = words.length;
            const firstDy =
              y < CENTER - 20
                ? -(lines - 1) * LINE_H - 2
                : y > CENTER + 20
                  ? LINE_H
                  : (-(lines - 1) * LINE_H) / 2 + 3;
            return (
              <text
                key={axis.key}
                className={`axis-radar-label${i === active ? ' is-active' : ''}`}
                x={x}
                y={y}
                textAnchor={anchor}
              >
                {words.map((word, w) => (
                  <tspan key={word} x={x} dy={w === 0 ? firstDy : LINE_H}>
                    {word}
                  </tspan>
                ))}
              </text>
            );
          })}
        </svg>

        {/* Real HTML buttons layered over the chart rather than focusable
            SVG nodes. An SVG <g tabindex="0"> does take DOM focus in
            Chrome, but fires no focus/focusin event at all, so React's
            onFocus never ran and the chart was mouse-only. Buttons also
            get :focus-visible and Enter/Space for free. Positioned in
            percentages off the same pointAt() math the SVG uses, so the
            two layers stay aligned as the chart scales. */}
        <div className="axis-radar-hotspots">
          {axes.map((axis, i) => {
            const [x, y] = pointAt(i, count, axis.percentile!);
            return (
              <button
                key={axis.key}
                type="button"
                className="axis-radar-hotspot"
                style={{ left: `${(x / SIZE) * 100}%`, top: `${(y / SIZE) * 100}%` }}
                aria-label={`${axis.label}: ${axis.percentile}`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
            );
          })}
        </div>
      </div>

      {/* The explanatory note doubles as the readout slot: while an axis is
          hovered or focused it shows that axis's exact number, and drops
          back to the legend when nothing is active. One line either way, so
          the panel never changes height. aria-live announces the value to a
          screen reader arrowing through the vertices. */}
      <p className="axis-radar-note" aria-live="polite">
        {active === null ? (
          t('evaluation.radarNote')
        ) : (
          <span className="axis-radar-readout">
            <strong>{axes[active].label}</strong>
            <span>{t('evaluation.radarReadout', { percentile: axes[active].percentile })}</span>
          </span>
        )}
      </p>
    </figure>
  );
}
