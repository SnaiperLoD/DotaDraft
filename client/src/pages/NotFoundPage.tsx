import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import './NotFoundPage.css';

export default function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="page not-found-page" data-testid="not-found">
      <p className="not-found-kicker">{t('notFound.kicker')}</p>
      <h1 className="not-found-title">{t('notFound.title')}</h1>
      <p className="not-found-copy">{t('notFound.copy')}</p>
      <Link to="/" className="btn btn-primary" data-testid="not-found-home" viewTransition>
        {t('notFound.home')}
      </Link>
    </div>
  );
}
