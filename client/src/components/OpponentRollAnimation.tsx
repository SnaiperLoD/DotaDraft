import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { heroPortraitUrl } from '../utils/heroIcon';
import './OpponentRollAnimation.css';

// Blueprint/10-tech-debt-backlog.md, "Анимация подбора оппонента (рулетка)"
// — first-pass draft, art direction to follow once the user sees it live.
// OpponentPoolService.pullRandom() resolves near-instantly, so without
// this there's no visible "searching" moment at all between clicking
// Enter Battle and the result appearing — this fills that gap with a
// slot-machine-style cycle through random hero portraits. Purely
// decorative: doesn't know or care what the real opponent will be.
const HERO_ID_POOL = [
  1, 2, 3, 6, 7, 8, 9, 11, 14, 17, 19, 21, 25, 26, 28, 31, 35, 36, 39, 41, 44, 46, 51, 54, 58, 62, 67, 69, 72, 74, 78,
  84, 86, 90, 91, 96, 104, 106, 110, 114, 120, 126, 128, 131, 135, 137, 145,
];
const SLOT_COUNT = 5;
const TICK_MS = 90;

function randomHeroId(): number {
  return HERO_ID_POOL[Math.floor(Math.random() * HERO_ID_POOL.length)];
}

export default function OpponentRollAnimation() {
  const { t } = useTranslation();
  const [slots, setSlots] = useState<number[]>(() => Array.from({ length: SLOT_COUNT }, randomHeroId));

  useEffect(() => {
    const interval = setInterval(() => {
      setSlots(Array.from({ length: SLOT_COUNT }, randomHeroId));
    }, TICK_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="opponent-roll">
      <div className="opponent-roll-label">{t('battle.findingOpponent')}</div>
      <div className="opponent-roll-slots">
        {slots.map((heroId, i) => (
          <img key={i} src={heroPortraitUrl(heroId)} alt="" className="opponent-roll-slot" width={80} height={50} />
        ))}
      </div>
    </div>
  );
}
