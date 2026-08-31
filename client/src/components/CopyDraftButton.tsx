import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { encodeCopiedDraft } from 'shared';
import { track } from '../telemetry';

export interface CopyDraftHero {
  heroId: number;
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

function draftCode(heroes: CopyDraftHero[]): string {
  return encodeCopiedDraft(
    heroes.filter((h) => h.assignedRole).map((h) => ({ heroId: h.heroId, role: h.assignedRole as string })),
  );
}

export default function CopyDraftButton({ heroes, className, compact }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    let text: string;
    try {
      text = draftCode(heroes);
    } catch {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      track('draft_copy', { source: compact ? 'history' : 'draft' });
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
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
      data-testid="copy-draft"
      onClick={() => void handleCopy()}
    >
      {copied ? t('draft.copied') : t('draft.copyDraft')}
    </button>
  );
}
