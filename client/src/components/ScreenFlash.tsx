import { createPortal } from 'react-dom';
import './ScreenFlash.css';

interface Props {
  outcome: 'Win' | 'Lose';
  // Changing this remounts the flash element, restarting the fade-out
  // animation — needed because two Wins (or two Losses) in a row wouldn't
  // otherwise change the className and CSS animations don't replay on an
  // unchanged element.
  flashKey: number;
}

// Full-viewport brighten (Win) / darken (Lose) pulse that fades to nothing
// over ~1.3s — a more visceral outcome signal than the text-only "Victory"/
// "Defeat" line above it. Portaled to document.body so it covers the whole
// screen regardless of where BattlePanel sits in the page (and however far
// the user has scrolled), not just its own container.
export default function ScreenFlash({ outcome, flashKey }: Props) {
  return createPortal(
    <div
      key={flashKey}
      className={`screen-flash screen-flash--${outcome === 'Win' ? 'win' : 'lose'}`}
      aria-hidden="true"
    />,
    document.body,
  );
}
