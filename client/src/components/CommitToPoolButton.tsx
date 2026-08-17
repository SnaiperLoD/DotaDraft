import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { getSubmitterToken } from '../utils/submitterToken';
import { track } from '../telemetry';

interface Props {
  draftId: string;
}

export default function CommitToPoolButton({ draftId }: Props) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleCommit = async () => {
    setStatus('loading');
    setError(null);
    try {
      await api.commitToPool(draftId, getSubmitterToken());
      setStatus('done');
      track('pool_commit', { ok: true }, draftId);
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
      track('pool_commit', { ok: false }, draftId);
    }
  };

  if (status === 'done') {
    return <p className="loading-text">{t('commitToPool.done')}</p>;
  }

  return (
    <div>
      <button
        className="btn btn-secondary"
        onClick={() => void handleCommit()}
        disabled={status === 'loading'}
      >
        {status === 'loading' && <span className="btn-spinner" aria-hidden="true" />}
        {status === 'loading' ? t('commitToPool.committing') : t('commitToPool.commit')}
      </button>
      {status === 'error' && <p className="error-text">{error}</p>}
    </div>
  );
}
