import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import './LegendPanel.css';

// Blueprint/10-tech-debt-backlog.md, "Легенда обозначений" — a single
// reference for every color-coded system in the app that isn't otherwise
// explained on-screen (role gradients, the pick-highlight border, custom
// tag rarity, Evaluation percentile pills). Mounted once, globally
// (App.tsx), fixed to a corner — the visual systems it explains span
// Draft/Evaluation, not just one page.
const ROLE_SWATCHES = [
  { key: 'Carry', rgb: '163, 49, 63' },
  { key: 'Offlane', rgb: '38, 130, 125' },
  { key: 'Mid', rgb: '45, 82, 130' },
  { key: 'Support', rgb: '142, 78, 168' },
  { key: 'Universal', rgb: '196, 130, 45' },
] as const;

const RARITY_TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;

export default function LegendPanel() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div className="legend-widget">
      {open && (
        <div className="legend-panel panel">
          <div className="legend-header">
            <span>{t('legend.title')}</span>
            <button type="button" className="legend-close" onClick={() => setOpen(false)} aria-label={t('legend.close')}>
              ×
            </button>
          </div>

          <section className="legend-section">
            <h4>{t('legend.rolesHeading')}</h4>
            <p className="legend-note">{t('legend.rolesNote')}</p>
            <div className="legend-swatch-row">
              {ROLE_SWATCHES.map((r) => (
                <div key={r.key} className="legend-swatch-item">
                  <span className="legend-swatch" style={{ background: `rgb(${r.rgb})` }} aria-hidden="true" />
                  <span>{t(`positions.${r.key}`)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="legend-section">
            <h4>{t('legend.pickHighlightHeading')}</h4>
            <div className="legend-row">
              <span className="legend-border-swatch legend-border-swatch--best" aria-hidden="true" />
              <span>{t('legend.pickHighlightBest')}</span>
            </div>
            <div className="legend-row">
              <span className="legend-border-swatch legend-border-swatch--worst" aria-hidden="true" />
              <span>{t('legend.pickHighlightWorst')}</span>
            </div>
          </section>

          <section className="legend-section">
            <h4>{t('legend.tagsHeading')}</h4>
            <p className="legend-note">{t('legend.tagsNote')}</p>
            <div className="legend-swatch-row">
              {RARITY_TIERS.map((rarity) => (
                <div key={rarity} className="legend-swatch-item">
                  <span className={`legend-rarity-swatch rarity-${rarity}`} aria-hidden="true" />
                  <span>{t(`legend.rarity.${rarity}`)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="legend-section">
            <h4>{t('legend.percentileHeading')}</h4>
            <p className="legend-note">{t('legend.percentileNote')}</p>
            <div className="legend-row">
              <span className="percentile-pill percentile-high">{t('legend.percentileHigh')}</span>
            </div>
            <div className="legend-row">
              <span className="percentile-pill percentile-mid">{t('legend.percentileMid')}</span>
            </div>
            <div className="legend-row">
              <span className="percentile-pill percentile-low">{t('legend.percentileLow')}</span>
            </div>
          </section>
        </div>
      )}

      <button
        type="button"
        className="legend-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-label={t('legend.toggle')}
        aria-expanded={open}
      >
        ?
      </button>
    </div>
  );
}
