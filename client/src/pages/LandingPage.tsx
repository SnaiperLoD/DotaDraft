import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AdSlot from '../components/AdSlot';
import './LandingPage.css';

export default function LandingPage() {
  const { t } = useTranslation();

  return (
    <div className="page landing-page">
      <div className="landing-hero">
        <h1 className="landing-title">{t('landing.title')}</h1>
        <p className="landing-tagline">{t('landing.tagline')}</p>
        <p className="landing-pitch">{t('landing.pitch')}</p>
        <div className="landing-actions">
          <Link to="/draft" className="btn btn-primary">
            {t('landing.cta')}
          </Link>
          <Link to="/about" className="btn btn-secondary">
            {t('landing.aboutLink')}
          </Link>
        </div>
      </div>
      <AdSlot size="leaderboard" />
    </div>
  );
}
