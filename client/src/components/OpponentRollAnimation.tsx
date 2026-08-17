import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BattleOpponentHero } from 'shared';
import { heroPortraitUrl } from '../utils/heroIcon';
import './OpponentRollAnimation.css';

// Blueprint/10-tech-debt-backlog.md, "Анимация подбора оппонента (рулетка)".
// OpponentPoolService.pullRandom() resolves near-instantly, so without this
// there is no visible "finding an opponent" moment between clicking Enter
// Battle and the result. Two phases, both driven from BattlePanel:
//
//   1. Searching — `opponentHeroes` is null while the request is in flight:
//      every slot cycles through random portraits (slot-machine spin).
//   2. Settling — once the real opponent is known, the slots lock onto the
//      actual heroes ONE AT A TIME, left to right, each with a thunk. Per
//      user: the roll should read as picking the opponent up one hero at a
//      time even though the draft was really chosen whole. When the last slot
//      lands, `onSettled` hands off to the full faceoff.
//
// The component instance is kept across both phases (BattlePanel keys it on
// the fight, not the phase), so the spin flows straight into the settle
// instead of restarting.
const HERO_ID_POOL = [
  1, 2, 3, 6, 7, 8, 9, 11, 14, 17, 19, 21, 25, 26, 28, 31, 35, 36, 39, 41, 44, 46, 51, 54, 58, 62, 67, 69, 72,
  74, 78, 84, 86, 90, 91, 96, 104, 106, 110, 114, 120, 126, 128, 131, 135, 137, 145,
];
const SLOT_COUNT = 5;
// Slower than the original flat 90ms cycle — the spin should read as reels
// turning, not a strobe.
const SPIN_TICK_MS = 130;
// Gap between each slot locking in. Five slots × this is the settle's length.
const SETTLE_STEP_MS = 430;
// Beat after the last slot lands before the faceoff takes over.
const FINAL_BEAT_MS = 520;

function randomHeroId(): number {
  return HERO_ID_POOL[Math.floor(Math.random() * HERO_ID_POOL.length)];
}

interface Props {
  // null while still searching; the real opponent's heroes once known, which
  // is what starts the one-by-one settle.
  opponentHeroes?: BattleOpponentHero[] | null;
  // Called once every slot has locked in (plus a short beat), so the caller
  // can reveal the full result.
  onSettled?: () => void;
}

export default function OpponentRollAnimation({ opponentHeroes = null, onSettled }: Props) {
  const { t } = useTranslation();
  const [spinIds, setSpinIds] = useState<number[]>(() => Array.from({ length: SLOT_COUNT }, randomHeroId));
  const [lockedCount, setLockedCount] = useState(0);
  // onSettled can be a fresh closure each parent render; keep it in a ref so
  // the settle effect below only depends on the count, never re-firing its
  // timer because the callback identity changed.
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  // Cycle the not-yet-locked slots.
  useEffect(() => {
    const id = setInterval(() => {
      setSpinIds((prev) => prev.map((v, i) => (i < lockedCount ? v : randomHeroId())));
    }, SPIN_TICK_MS);
    return () => clearInterval(id);
  }, [lockedCount]);

  // Once the real opponent is known, lock the slots one at a time, then hand
  // off. No-op while searching (opponentHeroes null).
  useEffect(() => {
    if (!opponentHeroes) return;
    if (lockedCount >= opponentHeroes.length) {
      const t = setTimeout(() => onSettledRef.current?.(), FINAL_BEAT_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setLockedCount((c) => c + 1), SETTLE_STEP_MS);
    return () => clearTimeout(t);
  }, [opponentHeroes, lockedCount]);

  return (
    <div className="opponent-roll">
      <div className="opponent-roll-label">{t('battle.findingOpponent')}</div>
      <div className="opponent-roll-slots">
        {Array.from({ length: SLOT_COUNT }, (_, i) => {
          const locked = opponentHeroes != null && i < lockedCount;
          const heroId = locked ? opponentHeroes[i].heroId : (spinIds[i] ?? randomHeroId());
          return (
            <div key={i} className={`opponent-roll-cell${locked ? ' is-locked' : ''}`}>
              <img
                src={heroPortraitUrl(heroId)}
                alt=""
                className="opponent-roll-slot"
                width={90}
                height={56}
              />
              {locked && <span className="opponent-roll-cell-name">{opponentHeroes[i].heroName}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
