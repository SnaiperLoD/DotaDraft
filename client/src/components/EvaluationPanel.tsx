import { useState } from 'react';
import { api } from '../api/client';
import type { EvaluationResult } from 'shared';
import './EvaluationPanel.css';

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
      <div className="evaluation-panel">
        <button className="btn btn-primary" onClick={() => void handleEvaluate()} disabled={loading}>
          {loading ? 'Evaluating…' : 'Evaluate Draft'}
        </button>
        {error && <p className="error-text">{error}</p>}
      </div>
    );
  }

  return (
    <div className="evaluation-panel">
      <h3 className="evaluation-title">
        Evaluation — Total Score: <em>{result.totalScore}/10</em>
      </h3>

      <div className="evaluation-summary">
        <div className="evaluation-summary-col">
          <div className="evaluation-summary-heading">Strengths</div>
          <ul>
            {result.summary.strengths.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
        <div className="evaluation-summary-col">
          <div className="evaluation-summary-heading">Weaknesses</div>
          <ul>
            {result.summary.weaknesses.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="evaluation-breakdown">
        {result.breakdown.map((item) => (
          <div key={item.key} className="panel evaluation-item">
            <div className="evaluation-item-header">
              <span>{item.label}</span>
              <span className="score">{item.score === null ? 'N/A' : `${item.score}/10`}</span>
            </div>
            <ul>
              {item.explanation.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
