import { useTranslation } from 'react-i18next';
import { bugReportMailtoHref } from '../utils/bugReport';
import { tipJarUrl } from '../utils/tipJar';
import './Footer.css';

const GITHUB_URL = 'https://github.com/SnaiperLoD/DotaDraft';

export default function Footer() {
  const { t, i18n } = useTranslation();
  const tip = tipJarUrl();

  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <span className="app-footer-brand">DotaDraft</span>
        <nav className="app-footer-links">
          {tip && (
            <a href={tip} target="_blank" rel="noopener noreferrer" data-testid="footer-tip-jar">
              {t('footer.tipJar')}
            </a>
          )}
          <a href={bugReportMailtoHref(i18n.language)}>{t('footer.email')}</a>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            {t('footer.github')}
          </a>
        </nav>
      </div>
    </footer>
  );
}
