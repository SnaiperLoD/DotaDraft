import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './AboutPage.css';

const SECTIONS = ['evaluation', 'battle', 'ceiling'] as const;

export default function AboutPage() {
  const { t } = useTranslation();

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
            className={`panel about-section${key === 'ceiling' ? ' about-section--caveat' : ''}`}
          >
            <h3>{t(`about.${key}Title`)}</h3>
            <p>{t(`about.${key}Text`)}</p>
          </section>
        ))}
      </div>

      <div className="about-cta">
        <Link to="/draft" className="btn btn-primary">
          {t('landing.cta')}
        </Link>
      </div>
    </div>
  );
}
