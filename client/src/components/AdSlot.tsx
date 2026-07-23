import './AdSlot.css';

// Reserved static banner placement (Blueprint/00-project-overview.md
// Monetization: banners only, no interstitial/rewarded triggers). Styled
// as an honest placeholder — dashed border, plain label — rather than
// disguised as game content, so it reads as "ad slot" at a glance both
// now (empty) and once a real network fills it.
interface Props {
  size: 'leaderboard' | 'rectangle';
}

const DIMENSIONS: Record<Props['size'], string> = {
  leaderboard: '728 × 90',
  rectangle: '300 × 250',
};

export default function AdSlot({ size }: Props) {
  return (
    <div className={`ad-slot ad-slot-${size}`}>
      <span className="ad-slot-label">Advertisement</span>
      <span className="ad-slot-dims">{DIMENSIONS[size]}</span>
    </div>
  );
}
