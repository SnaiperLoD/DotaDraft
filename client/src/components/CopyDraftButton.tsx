import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ROLES } from 'shared';
import { track } from '../telemetry';

export interface CopyDraftHero {
  heroName: string;
  assignedRole: string | null;
  pickOrder?: number;
}

interface Props {
  heroes: CopyDraftHero[];
  className?: string;
  /** Smaller ghost button for dense lists (History). */
  compact?: boolean;
}

function formatDraftLines(heroes: CopyDraftHero[], roleLabel: (role: string) => string): string {
  const roleIndex = (role: string | null) => {
    if (!role) return 99;
    const i = (ROLES as readonly string[]).indexOf(role);
    return i === -1 ? 50 : i;
  };
  const sorted = [...heroes].sort((a, b) => {
    const ra = roleIndex(a.assignedRole);
    const rb = roleIndex(b.assignedRole);
    if (ra !== rb) return ra - rb;
    return (a.pickOrder ?? 0) - (b.pickOrder ?? 0);
  });
  return sorted
    .map((h) => {
      const role = h.assignedRole ? roleLabel(h.assignedRole) : '—';
      return `${role}: ${h.heroName}`;
    })
    .join('\n');
}

export default function CopyDraftButton({ heroes, className, compact }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = formatDraftLines(heroes, (role) => t(`roles.${role}`));
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      track('draft_copy', { source: compact ? 'history' : 'draft' });
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Fallback for older / restricted contexts.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        track('draft_copy', { source: compact ? 'history' : 'draft' });
        window.setTimeout(() => setCopied(false), 1600);
      } finally {
        document.body.removeChild(ta);
      }
    }
  };

  return (
    <button
      type="button"
      className={className ?? (compact ? 'btn btn-ghost btn-sm' : 'btn btn-secondary')}
      onClick={() => void handleCopy()}
    >
      {copied ? t('draft.copied') : t('draft.copyDraft')}
    </button>
  );
}
