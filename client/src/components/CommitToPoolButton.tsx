import { useState } from 'react';
import { api } from '../api/client';
import { getSubmitterToken } from '../utils/submitterToken';

interface Props {
  draftId: string;
}

export default function CommitToPoolButton({ draftId }: Props) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleCommit = async () => {
    setStatus('loading');
    setError(null);
    try {
      await api.commitToPool(draftId, getSubmitterToken());
      setStatus('done');
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
    }
  };

  if (status === 'done') {
    return (
      <p className="loading-text">
        Committed to the Opponent Pool — other players may now face this draft in Battle Mode.
      </p>
    );
  }

  return (
    <div>
      <button className="btn btn-secondary" onClick={() => void handleCommit()} disabled={status === 'loading'}>
        {status === 'loading' ? 'Committing…' : 'Commit to Pool'}
      </button>
      {status === 'error' && <p className="error-text">{error}</p>}
    </div>
  );
}
