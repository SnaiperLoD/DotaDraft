import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { heroPortraitUrl } from '../utils/heroIcon';
import './TapalkaWidget.css';

// Blueprint/10-tech-debt-backlog.md, "Тапалка" — pure tactile/engagement
// filler for the draft-thinking wait, no gameplay effect and no reward.
// By explicit user decision, this renders
// a real 3D Brewmaster model (TapalkaModel3D.tsx, three.js + a glTF mirrored
// from pissang/dota2hero) rather than an original non-Dota mascot — same
// accepted legal/IP risk as the rest of the project's Dota assets.
//
// No skeletal animation on the model (see TapalkaModel3D.tsx's own comment
// for why — the source's animations are raw .smd files, not glTF clips).
// The 3D component's continuous turntable rotation is the idle "alive" cue;
// this component layers a CSS "drink" sequence on top on click (mug that
// tips and pours, rising foam bubbles, a warm glow pulse, a punchy bounce on
// the model's own container) — the 3D model itself reacts by spinning
// faster for that window (passed down via the `drinking` prop).
// React.lazy-loaded: the three.js chunk (~600KB) has no reason to block
// first paint on every other route, or even this one — the static portrait
// (old asset, still in the bundle) covers the gap until it's ready.
// Click counter is session-only (component state) — no localStorage, no
// server call, resets on reload by design.
const BREWMASTER_ID = 78;
const DRINK_ANIMATION_MS = 900;
const MODEL_WIDTH = 150;
const MODEL_HEIGHT = 150;

const TapalkaModel3D = lazy(() => import('./TapalkaModel3D'));

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
const BUBBLE_COUNT = 6;

interface Props {
  embedded?: boolean;
}

// On mobile / reduced-motion, skip the lazy three.js chunk (~600KB) and
// keep the static Brewmaster portrait. The 3D turntable is the idle cue;
// without it the CSS drink sequence on click still runs.
const TAPALKA_STATIC_MQ = '(max-width: 720px), (prefers-reduced-motion: reduce)';

function useStaticTapalka(): boolean {
  const [staticModel, setStaticModel] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(TAPALKA_STATIC_MQ).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(TAPALKA_STATIC_MQ);
    const update = () => setStaticModel(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return staticModel;
}

export default function TapalkaWidget({ embedded = false }: Props) {
  const { t } = useTranslation();
  const [clicks, setClicks] = useState(0);
  const [drinkKey, setDrinkKey] = useState(0);
  const [drinking, setDrinking] = useState(false);
  const [voiceLine, setVoiceLine] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staticModel = useStaticTapalka();

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  const handleClick = () => {
    setClicks((c) => c + 1);
    setDrinkKey((k) => k + 1);
    setDrinking(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setDrinking(false), DRINK_ANIMATION_MS);

    if (Math.random() < VOICE_LINE_CHANCE) {
      const line = VOICE_LINES[Math.floor(Math.random() * VOICE_LINES.length)];
      setVoiceLine(line);
      setTimeout(() => setVoiceLine(null), VOICE_LINE_DISPLAY_MS);
    }
  };

  const portrait = (
    <img
      src={heroPortraitUrl(BREWMASTER_ID)}
      alt="Brewmaster"
      width={MODEL_WIDTH}
      height={MODEL_HEIGHT}
      className="tapalka-portrait"
    />
  );

  return (
    <div className={`${embedded ? 'tapalka tapalka--embedded' : 'panel tapalka'}`}>
      {!embedded && <div className="tapalka-heading">{t('tapalka.heading')}</div>}
      <button
        type="button"
        className="tapalka-button"
        onClick={handleClick}
        aria-label={t('tapalka.heading')}
      >
        {voiceLine && <span className="tapalka-speech-bubble">{voiceLine}</span>}
        <span className={`tapalka-glow${drinking ? ' tapalka-glow--active' : ''}`} aria-hidden="true" />
        <span
          className={`tapalka-portrait-wrap${drinking ? ' tapalka-portrait-wrap--drinking' : ''}`}
          data-testid={staticModel ? 'tapalka-static' : 'tapalka-3d'}
        >
          {staticModel ? (
            portrait
          ) : (
            <Suspense fallback={portrait}>
              <TapalkaModel3D drinking={drinking} width={MODEL_WIDTH} height={MODEL_HEIGHT} />
            </Suspense>
          )}
          {drinking && (
            <span key={drinkKey} className="tapalka-mug" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26">
                <path
                  d="M5 8h11v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8Z"
                  fill="var(--gold-bright)"
                  stroke="var(--bronze)"
                  strokeWidth="1.2"
                />
                <path
                  d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"
                  fill="none"
                  stroke="var(--bronze)"
                  strokeWidth="1.4"
                />
                <path d="M6 8h9" stroke="var(--gold)" strokeWidth="1.2" />
              </svg>
              <span className="tapalka-mug-foam" />
            </span>
          )}
          {drinking &&
            Array.from({ length: BUBBLE_COUNT }, (_, i) => (
              <span
                key={`${drinkKey}-bubble-${i}`}
                className="tapalka-bubble"
                style={{
                  left: `${18 + i * 12 + (i % 2 === 0 ? -4 : 4)}%`,
                  animationDelay: `${i * 60}ms`,
                }}
              />
            ))}
        </span>
      </button>
      <div className="tapalka-count">{t('tapalka.clicks', { count: clicks })}</div>
    </div>
  );
}
