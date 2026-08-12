import { useEffect, useMemo, useState } from 'react';
import { request } from '../api/client';
import type { DebugDatasetInfo, HeroDebugMatrix, HeroDebugRow } from '../api/types';
import { heroIconUrl } from '../utils/heroIcon';
import './DebugMatrixPage.css';

// Testing-only page (route registered only when import.meta.env.DEV, see
// App.tsx). Deliberately NOT translated and NOT in the site design language —
// it's an instrument panel, not product surface, and making it look like the
// rest of the app would invite someone to treat it as one.

// Axis order is fixed rather than Object.keys() so columns don't reshuffle
// when HeroEvaluationValues gains a field.
const AXES = [
  'teamfight',
  'tempo',
  'scaling',
  'mobility',
  'objectives',
  'control',
  'durability',
  'burst',
  'map_control',
  'saving',
  'initiating',
  'skirmish_rate',
  'camp_stacking',
  'resource_efficiency',
] as const;

const AXIS_SHORT: Record<(typeof AXES)[number], string> = {
  teamfight: 'tf',
  tempo: 'tmp',
  scaling: 'scl',
  mobility: 'mob',
  objectives: 'obj',
  control: 'ctl',
  durability: 'dur',
  burst: 'brs',
  map_control: 'map',
  saving: 'sav',
  initiating: 'ini',
  skirmish_rate: 'skr',
  camp_stacking: 'cmp',
  resource_efficiency: 'res',
};

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`);
const pp = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}`;

// Same >=10pp threshold simulate-self-play flags on, so the page and the
// simulation agree on what counts as an anomaly.
const FLAG_THRESHOLD = 0.1;
function divClass(v: number | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (Math.abs(v) >= FLAG_THRESHOLD) return v > 0 ? 'is-over' : 'is-under';
  return 'is-ok';
}

export default function DebugMatrixPage() {
  const [data, setData] = useState<HeroDebugMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<string>('div:tagsBlend');
  const [filter, setFilter] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  useEffect(() => {
    // Testing-only endpoint; the server registers /dev only outside production
    // (app.module.ts). Called here, inside the lazily-imported page, rather
    // than via a method on the shared `api` object, so /dev/hero-matrix never
    // appears in a production bundle.
    request<HeroDebugMatrix>('/dev/hero-matrix')
      .then(setData)
      .catch((err) => setError((err as Error).message));
  }, []);

  // Which dataset drives the "flagged" filter and the default sort — the
  // production one if it exists, otherwise whatever was generated.
  const primaryKey = useMemo(() => {
    if (!data) return 'tagsBlend';
    const present = data.datasets.filter((d) => d.present);
    return present.find((d) => d.key === 'tagsBlend')?.key ?? present.at(-1)?.key ?? 'tagsBlend';
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = filter.trim().toLowerCase();
    const filtered = data.rows.filter((r) => {
      if (onlyFlagged && Math.abs(r.divergence[primaryKey] ?? 0) < FLAG_THRESHOLD) return false;
      if (!needle) return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        r.tags.some((t) => t.name.toLowerCase().includes(needle))
      );
    });
    const num = (v: number | null | undefined) => (v === null || v === undefined ? -Infinity : v);
    const [kind, key] = sortKey.split(':');
    return filtered.sort((a, b) => {
      if (kind === 'name') return a.name.localeCompare(b.name);
      if (kind === 'real') return num(b.realWinRate) - num(a.realWinRate);
      if (kind === 'wr') return num(b.ourWinRate[key]) - num(a.ourWinRate[key]);
      if (kind === 'axis') {
        const axis = key as (typeof AXES)[number];
        return num(b.axes[axis]) - num(a.axes[axis]);
      }
      return num(b.divergence[key]) - num(a.divergence[key]);
    });
  }, [data, sortKey, filter, onlyFlagged, primaryKey]);

  if (error) return <div className="debug-page">Failed to load: {error}</div>;
  if (!data) return <div className="debug-page">Loading hero matrix…</div>;

  const flagged = data.rows.filter(
    (r) => Math.abs(r.divergence[primaryKey] ?? 0) >= FLAG_THRESHOLD,
  ).length;

  return (
    <div className="debug-page">
      <header className="debug-head">
        <h1>Hero calibration matrix</h1>
        <p className="debug-warning">
          Testing build only — this route does not exist in a production bundle, and the API behind
          it is not registered when NODE_ENV=production.
        </p>
        <div className="debug-sources">
          {data.datasets.map((d) => (
            <DatasetLine key={d.key} dataset={d} />
          ))}
        </div>
      </header>

      <div className="debug-controls">
        <input
          type="search"
          placeholder="filter by hero or tag…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={onlyFlagged}
            onChange={(e) => setOnlyFlagged(e.target.checked)}
          />
          only |Δ| ≥ 10pp
        </label>
        <span className="debug-count">
          {rows.length} shown · {flagged} flagged of {data.rows.length} (by {primaryKey})
        </span>
      </div>

      <div className="debug-scroll">
        <table className="debug-table">
          <thead>
            <tr>
              <th className="sticky-col">
                <button type="button" onClick={() => setSortKey('name:')}>
                  hero
                </button>
              </th>
              <th>tags</th>
              <th className="group-start">
                <button type="button" onClick={() => setSortKey('real:')}>
                  real WR
                </button>
              </th>
              {data.datasets.map((d) => (
                <th key={d.key} title={d.label}>
                  <button type="button" onClick={() => setSortKey(`wr:${d.key}`)}>
                    {d.key}
                  </button>
                </th>
              ))}
              {data.datasets.map((d) => (
                <th key={d.key} className="group-start" title={`divergence vs real — ${d.label}`}>
                  <button type="button" onClick={() => setSortKey(`div:${d.key}`)}>
                    Δ {d.key}
                  </button>
                </th>
              ))}
              {AXES.map((axis, i) => (
                <th key={axis} className={`axis-col${i === 0 ? ' group-start' : ''}`} title={axis}>
                  <button type="button" onClick={() => setSortKey(`axis:${axis}`)}>
                    {AXIS_SHORT[axis]}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row key={row.heroId} row={row} datasets={data.datasets} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DatasetLine({ dataset }: { dataset: DebugDatasetInfo }) {
  const cfg = dataset.config;
  const disabled = Array.isArray(cfg?.disabledTags) ? (cfg.disabledTags as string[]) : [];
  return (
    <div className={dataset.present ? undefined : 'is-missing'}>
      <span className="ds-key">{dataset.key}</span>
      <span className="ds-label">{dataset.label}</span>
      {dataset.present ? (
        <span className="ds-meta">
          {dataset.generatedAt ?? 'no timestamp'}
          {cfg ? ` · seed ${String(cfg.seed)} · ${String(cfg.nMatches)} matches` : ''}
          {cfg ? ` · realWinRateWeight=${String(cfg.realWinRateWeight)}` : ''}
          {disabled.length > 0 ? ` · ${disabled.length} tags off` : ''}
        </span>
      ) : (
        <span className="ds-meta">
          missing — run <code>npm run build-debug-matrix</code> in server/
        </span>
      )}
    </div>
  );
}

function Row({ row, datasets }: { row: HeroDebugRow; datasets: DebugDatasetInfo[] }) {
  return (
    <tr>
      <th className="sticky-col">
        <img src={heroIconUrl(row.heroId)} alt="" width={22} height={22} />
        <span>{row.name}</span>
        <em>{row.primaryAttribute}</em>
      </th>
      <td className="tag-cell">
        {row.tags.length === 0 ? (
          <span className="muted">—</span>
        ) : (
          row.tags.map((t) => (
            <span key={t.name} className={`debug-tag${t.hidden ? ' is-hidden-tag' : ''}`}>
              {t.name}
              {t.hidden && <i title="never rendered to a player">•</i>}
            </span>
          ))
        )}
      </td>
      <td className="num group-start">{pct(row.realWinRate)}</td>
      {datasets.map((d) => (
        <td key={d.key} className="num">
          {pct(row.ourWinRate[d.key])}
        </td>
      ))}
      {datasets.map((d) => (
        <td key={d.key} className={`num group-start ${divClass(row.divergence[d.key])}`}>
          {pp(row.divergence[d.key])}
        </td>
      ))}
      {AXES.map((axis, i) => {
        const v = row.axes[axis];
        return (
          <td
            key={axis}
            className={`axis-cell${i === 0 ? ' group-start' : ''}`}
            style={{ '--v': typeof v === 'number' ? v / 10 : 0 } as React.CSSProperties}
          >
            {typeof v === 'number' ? v.toFixed(1) : '—'}
          </td>
        );
      })}
    </tr>
  );
}
