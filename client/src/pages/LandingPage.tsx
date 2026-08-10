import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AdSlot from '../components/AdSlot';
import { heroPortraitUrl } from '../utils/heroIcon';
import './LandingPage.css';

// Fanned portrait cards behind the pitch — the landing page had no visual
// at all before, just centred text on the page background. All 127
// portraits ship in client/public/portraits, so this costs no network
// request and can't break on a CDN outage. Five heroes because five is
// the draft size the whole product is built around; the specific picks
// are a spread of silhouettes/colors that read well at a glance, not a
// balance statement.
const HERO_SHOWCASE = [
  { id: 5, tilt: -13, lift: 26 }, // Crystal Maiden
  { id: 2, tilt: -6, lift: 8 }, // Axe
  { id: 74, tilt: 0, lift: 0 }, // Invoker — centre card, sits highest
  { id: 8, tilt: 6, lift: 8 }, // Juggernaut
  { id: 41, tilt: 13, lift: 26 }, // Faceless Void
] as const;

const STEPS = ['draft', 'evaluate', 'battle'] as const;

export default function LandingPage() {
  const { t } = useTranslation();

  return (
    <div className="page landing-page">
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow">{t('landing.tagline')}</p>
          <h1 className="landing-title">
            Dota<span>Draft</span>
          </h1>
          <p className="landing-pitch">{t('landing.pitch')}</p>
          <div className="landing-actions">
            <Link to="/draft" className="btn btn-primary">
              {t('landing.cta')}
            </Link>
            <Link to="/about" className="btn btn-secondary">
              {t('landing.aboutLink')}
            </Link>
          </div>
          <dl className="landing-facts">
            <div>
              <dt>127</dt>
              <dd>{t('landing.facts.heroes')}</dd>
            </div>
            <div>
              <dt>5</dt>
              <dd>{t('landing.facts.picks')}</dd>
            </div>
            <div>
              <dt>0</dt>
              <dd>{t('landing.facts.accounts')}</dd>
            </div>
          </dl>
        </div>

        <div className="landing-hero-art" aria-hidden="true">
          <div className="landing-fan">
            {HERO_SHOWCASE.map((hero, i) => (
              <div
                key={hero.id}
                className="landing-fan-card"
                style={
                  {
                    '--tilt': `${hero.tilt}deg`,
                    '--lift': `${hero.lift}px`,
                    '--delay': `${i * 90}ms`,
                  } as React.CSSProperties
                }
              >
                <img src={heroPortraitUrl(hero.id)} alt="" width={220} height={137} loading="eager" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-steps">
        <div className="section-head">
          <h2>{t('landing.howItWorks')}</h2>
          <div className="rule" />
        </div>
        <ol className="landing-step-grid">
          {STEPS.map((step, i) => (
            <li key={step} className="plate landing-step">
              <span className="landing-step-index">{String(i + 1).padStart(2, '0')}</span>
              <h3>{t(`landing.steps.${step}.title`)}</h3>
              <p>{t(`landing.steps.${step}.text`)}</p>
            </li>
          ))}
        </ol>
      </section>

      <AdSlot size="leaderboard" />
    </div>
  );
}
