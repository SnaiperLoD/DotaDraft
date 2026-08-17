import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ru from './locales/ru.json';

export const SUPPORTED_LANGUAGES = ['en', 'ru'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = 'dotadraft-lang';

function initialLanguage(): SupportedLanguage {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && (SUPPORTED_LANGUAGES as readonly string[]).includes(stored)) return stored as SupportedLanguage;
  return 'en';
}

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ru: { translation: ru },
    },
    lng: initialLanguage(),
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  })
  .then(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = i18n.language;
  })
  .catch((err: unknown) => {
    console.error(err);
  });

// Keeps localStorage and i18next's own state in sync regardless of which
// one triggers the change — App.tsx's language switcher calls
// i18n.changeLanguage() directly, this listener is what persists it.
i18n.on('languageChanged', (lng) => {
  localStorage.setItem(STORAGE_KEY, lng);
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
});

if (typeof document !== 'undefined') document.documentElement.lang = i18n.language;

export default i18n;
