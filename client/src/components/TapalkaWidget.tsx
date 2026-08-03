import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { heroPortraitUrl } from '../utils/heroIcon';
import './TapalkaWidget.css';

// Blueprint/10-tech-debt-backlog.md, "Тапалка" — pure tactile/engagement
// filler for the draft-thinking wait, no gameplay effect and no reward
// (Monetization rule, Blueprint/00-project-overview.md: no real
// upgrades/currency from clicking). By explicit user decision, this uses
// Brewmaster's real static portrait (already in the app's asset set) with
// a CSS swing on click, rather than an original non-Dota mascot — legal/IP
// risk from Valve's non-commercial fan-content terms is explicitly
// accepted for now, deferred to when ad monetization actually goes live
// (see Blueprint/10-tech-debt-backlog.md for the research that flagged
// this). Click counter is session-only (component state) — no
// localStorage, no server call, resets on reload by design.
const BREWMASTER_ID = 78;

// A handful of Brewmaster's own real in-game lines (Blueprint/10-tech-debt-backlog.md
// research pass) — always shown in English regardless of the UI language,
// same as any other in-universe flavor text would be, not run through
// i18n. 1-in-100 chance per click, shown in HP's comic-speech-bubble style
// per the MVP scope decision (audio deferred to a future pass).
const VOICE_LINES = [
  'Drink it in!',
  'This one’s on me.',
  'I’ll drink to that.',
  'There’s trouble abrewing.',
  'Time to brawl!',
  'Drink and be bleary, for tomorrow we die.',
  'Just a bit tipsy.',
  'Punch drunk.',
];

const VOICE_LINE_CHANCE = 0.01;
const VOICE_LINE_DISPLAY_MS = 3000;

export default function TapalkaWidget() {
  const { t } = useTranslation();
  const [clicks, setClicks] = useState(0);
  const [swingKey, setSwingKey] = useState(0);
  const [voiceLine, setVoiceLine] = useState<string | null>(null);

  const handleClick = () => {
    setClicks((c) => c + 1);
    setSwingKey((k) => k + 1);
    if (Math.random() < VOICE_LINE_CHANCE) {
      const line = VOICE_LINES[Math.floor(Math.random() * VOICE_LINES.length)];
      setVoiceLine(line);
      setTimeout(() => setVoiceLine(null), VOICE_LINE_DISPLAY_MS);
    }
  };

  return (
    <div className="panel tapalka">
      <div className="tapalka-heading">{t('tapalka.heading')}</div>
      <button type="button" className="tapalka-button" onClick={handleClick} aria-label={t('tapalka.heading')}>
        {voiceLine && <span className="tapalka-speech-bubble">{voiceLine}</span>}
        <img key={swingKey} src={heroPortraitUrl(BREWMASTER_ID)} alt="Brewmaster" width={120} height={75} className="tapalka-portrait" />
      </button>
      <div className="tapalka-count">{t('tapalka.clicks', { count: clicks })}</div>
    </div>
  );
}
