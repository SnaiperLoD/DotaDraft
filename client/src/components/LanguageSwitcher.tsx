import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../i18n';
import './LanguageSwitcher.css';

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  return (
    <span className="language-switcher" role="group" aria-label={t('app.languageLabel')}>
      {SUPPORTED_LANGUAGES.map((lang) => (
        <button
          key={lang}
          type="button"
          className={i18n.language === lang ? 'active' : undefined}
          aria-pressed={i18n.language === lang}
          aria-label={t(`app.language.${lang}`)}
          onClick={() => void i18n.changeLanguage(lang)}
        >
          {lang.toUpperCase()}
        </button>
      ))}
    </span>
  );
}
