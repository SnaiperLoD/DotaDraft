import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { tipJarUrl } from '../utils/tipJar';
import './AboutPage.css';

const SECTIONS = ['evaluation', 'battle', 'ceiling'] as const;

export default function AboutPage() {
  const { t } = useTranslation();
  const tip = tipJarUrl();

  return (
    <div className="page about-page">
      <div className="section-head">
        <h2>{t('about.title')}</h2>
        <div className="rule" />
      </div>

      <p className="about-intro">{t('about.intro')}</p>

      <div className="about-sections">
        {SECTIONS.map((key) => (
          <section
            key={key}
            className={`panel bracketed about-section${key === 'ceiling' ? ' about-section--caveat' : ''}`}
          >
            <h3>{t(`about.${key}Title`)}</h3>
            <p>{t(`about.${key}Text`)}</p>
          </section>
        ))}
        {tip && (
          <section className="panel bracketed about-section about-section--tip">
            <h3>{t('about.tipJarTitle')}</h3>
            <p>{t('about.tipJarText')}</p>
            <a
              className="btn btn-secondary about-tip-link"
              href={tip}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="about-tip-jar"
            >
              {t('about.tipJarLink')}
            </a>
          </section>
        )}
      </div>

      <div className="about-cta">
        <Link to="/draft" className="btn btn-primary" viewTransition>
          {t('landing.cta')}
        </Link>
      </div>
    </div>
  );
}
