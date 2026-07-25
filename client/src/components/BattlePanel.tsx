import { useState } from 'react';
import ScreenFlash from './ScreenFlash';
import { ROLES } from 'shared';
import type { BattleResultResponse, BattleOpponentHero } from 'shared';
import { api } from '../api/client';
import { getSubmitterToken } from '../utils/submitterToken';
import { heroPortraitUrl } from '../utils/heroIcon';
import type { DraftHeroView } from '../api/types';
import AdSlot from './AdSlot';
import './BattlePanel.css';

function PortraitCard({ heroId, name, caption }: { heroId: number; name: string; caption?: string | null }) {
  return (
    <div className="portrait-card">
      <img src={heroPortraitUrl(heroId)} alt={name} width={130} height={81} />
      <div className="name">{name}</div>
      {caption && <div className="caption">{caption}</div>}
    </div>
  );
}

// Two rows of full portraits, ordered by role slot (Carry, Mid, Offlane,
// Soft Support, Hard Support) so the hero facing each of the user's picks
// lines up in the same column. No score/evaluation here on either side —
// Battle Mode is a separate system from the Evaluation Engine (Core Rules
// Separation) and this view is purely who's facing whom.
function FaceOff({
  myHeroes,
  opponentHeroes,
}: {
  myHeroes: DraftHeroView[];
  opponentHeroes: BattleOpponentHero[];
}) {
  const roleOrder = ROLES as readonly string[];
  const sortedMine = myHeroes
    .slice()
    .sort((a, b) => roleOrder.indexOf(a.assignedRole ?? '') - roleOrder.indexOf(b.assignedRole ?? ''));

  return (
    <div className="faceoff">
      <div className="faceoff-row">
        {sortedMine.map((h) => (
          <PortraitCard key={h.heroId} heroId={h.heroId} name={h.hero.name} caption={h.assignedRole} />
        ))}
      </div>
      <div className="faceoff-divider">VS</div>
      <div className="faceoff-row">
        {opponentHeroes.map((h) => (
          <PortraitCard key={h.heroId} heroId={h.heroId} name={h.heroName} />
        ))}
      </div>
    </div>
  );
}

interface Props {
  draftId: string;
  heroes: DraftHeroView[];
}

export default function BattlePanel({ draftId, heroes }: Props) {
  const [result, setResult] = useState<BattleResultResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [battleCount, setBattleCount] = useState(0);

  const handleFight = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.fightBattle(draftId, getSubmitterToken());
      setResult(res);
      setBattleCount((c) => c + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="battle-panel">
      <h3>Battle Mode</h3>

      {!result && (
        <button className="btn btn-primary" onClick={() => void handleFight()} disabled={loading}>
          {loading ? 'Finding Opponent…' : 'Enter Battle'}
        </button>
      )}

      {error && <p className="error-text">{error}</p>}

      {result && (
        <div className="battle-result">
          <ScreenFlash outcome={result.resolvedOutcome} flashKey={battleCount} />
          <p className="battle-outcome">
            {result.resolvedOutcome === 'Win' ? 'Victory' : 'Defeat'} — {result.confidenceTier} Confidence
          </p>

          <p className="battle-vs">
            vs.{' '}
            {result.opponent.teamName
              ? `${result.opponent.teamName}${result.opponent.leagueName ? ` (${result.opponent.leagueName})` : ''}`
              : result.opponent.source === 'pro'
                ? 'a professional draft'
                : 'another player'}
          </p>

          <FaceOff myHeroes={heroes} opponentHeroes={result.opponent.heroes} />

          {result.advantages.length > 0 && (
            <div className="battle-list-block">
              <div className="battle-list-heading">Advantages</div>
              <ul>
                {result.advantages.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          {result.disadvantages.length > 0 && (
            <div className="battle-list-block">
              <div className="battle-list-heading">Disadvantages</div>
              <ul>
                {result.disadvantages.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="battle-list-block">
            <div className="battle-list-heading">Explanation</div>
            <ul>
              {result.explanation.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>

          <div className="battle-ad">
            <AdSlot size="leaderboard" />
          </div>

          <button className="btn btn-primary" onClick={() => void handleFight()} disabled={loading}>
            {loading ? 'Finding Opponent…' : 'Fight Again'}
          </button>
          <p className="battle-count">Battles this visit: {battleCount}</p>
        </div>
      )}
    </div>
  );
}
