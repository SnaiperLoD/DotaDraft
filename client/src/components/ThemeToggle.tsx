import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import './ThemeToggle.css';

// The light palette has existed in tokens.css since the theme was
// designed, but the only way to reach it was to change the OS setting —
// there was no in-app control at all. This is that control.
//
// Three states, not two: "system" has to stay reachable, otherwise a
// first visit silently locks whichever theme the toggle happened to
// default to. Cycles system -> light -> dark -> system.
//
// Writing (or clearing) data-theme on <html> is the whole mechanism —
// tokens.css keys `color-scheme` off that attribute and every color token
// is a light-dark() pair that follows it. See index.html for the
// pre-paint script that applies the stored choice before React mounts, so
// a dark-theme user doesn't get a white flash on load.
export type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'dotadraft-theme';
const ORDER: ThemeChoice[] = ['system', 'light', 'dark'];

function storedChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // Private-mode / storage-disabled — fall through to the default.
  }
  return 'system';
}

function applyChoice(choice: ThemeChoice) {
  if (choice === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = choice;
  }
}

const ICONS: Record<ThemeChoice, ReactElement> = {
  system: (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16v4" strokeLinecap="round" />
    </svg>
  ),
  light: (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4.2" />
      <path
        d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"
        strokeLinecap="round"
      />
    </svg>
  ),
  dark: (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M20 13.6A8.4 8.4 0 1 1 10.4 4a6.6 6.6 0 0 0 9.6 9.6Z" strokeLinejoin="round" />
    </svg>
  ),
};

export default function ThemeToggle() {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<ThemeChoice>(storedChoice);

  useEffect(() => {
    applyChoice(choice);
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Same as above — the theme still applies for this session.
    }
  }, [choice]);

  const next = () => setChoice((c) => ORDER[(ORDER.indexOf(c) + 1) % ORDER.length]);

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={next}
      title={t(`theme.${choice}`)}
      aria-label={t('theme.toggle', { mode: t(`theme.${choice}`) })}
    >
      {ICONS[choice]}
    </button>
  );
}
