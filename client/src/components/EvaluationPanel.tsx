import { useState } from 'react';
import { api } from '../api/client';
import type { EvaluationResult } from 'shared';

interface Props {
  draftId: string;
}

export default function EvaluationPanel({ draftId }: Props) {
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEvaluate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getEvaluation(draftId);
      setResult(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!result) {
    return (
      <div style={{ marginTop: 16 }}>
        <button onClick={() => void handleEvaluate()} disabled={loading}>
          {loading ? 'Evaluating...' : 'Evaluate draft'}
        </button>
        {error && <p style={{ color: 'red' }}>{error}</p>}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      <h3>Evaluation — Total Score: {result.totalScore}/10</h3>

      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontWeight: 'bold' }}>Strengths</div>
          <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
            {result.summary.strengths.map((line, i) => (
              <li key={i} style={{ fontSize: 13 }}>
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontWeight: 'bold' }}>Weaknesses</div>
          <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
            {result.summary.weaknesses.map((line, i) => (
              <li key={i} style={{ fontSize: 13 }}>
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {result.breakdown.map((item) => (
          <div key={item.key} style={{ border: '1px solid #333', padding: 8 }}>
            <div style={{ fontWeight: 'bold' }}>
              {item.label}: {item.score === null ? 'N/A' : `${item.score}/10`}
            </div>
            <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
              {item.explanation.map((line, i) => (
                <li key={i} style={{ fontSize: 13 }}>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
