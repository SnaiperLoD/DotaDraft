import { useTranslation } from 'react-i18next';
import './ArchetypeSeal.css';

// Evaluate's draft-shape headline (Tempo / Late / 4+1 / …). One seal, not a
// pile of axes — same first-match-wins taxonomy the server classifier returns.
export default function ArchetypeSeal({
  archetypeId,
  compact = false,
  side,
}: {
  archetypeId: string | null | undefined;
  compact?: boolean;
  side?: 'mine' | 'opponent';
}) {
  const { t } = useTranslation();
  const label = archetypeId != null ? t(`evaluation.archetype.${archetypeId}`, { defaultValue: '' }) : '';
  if (!label) return null;

  return (
    <div
      className={`evaluation-archetype-seal${compact ? ' evaluation-archetype-seal--compact' : ''}`}
      title={t(`evaluation.archetypeHint.${archetypeId}`)}
      data-testid="draft-archetype"
      data-archetype={archetypeId}
      data-side={side}
    >
      <span className="evaluation-archetype-seal-ring" aria-hidden="true" />
      <span className="evaluation-archetype-seal-label">{label}</span>
    </div>
  );
}
