import { useTranslation } from 'react-i18next';
import './AboutPage.css';

export default function AboutPage() {
  const { t } = useTranslation();

  return (
    <div className="page about-page">
      <h2>{t('about.title')}</h2>
      <p className="about-intro">{t('about.intro')}</p>

      <section className="about-section">
        <h3>{t('about.evaluationTitle')}</h3>
        <p>{t('about.evaluationText')}</p>
      </section>

      <section className="about-section">
        <h3>{t('about.battleTitle')}</h3>
        <p>{t('about.battleText')}</p>
      </section>

      <section className="about-section">
        <h3>{t('about.ceilingTitle')}</h3>
        <p>{t('about.ceilingText')}</p>
      </section>
    </div>
  );
}
