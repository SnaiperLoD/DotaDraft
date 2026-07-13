import { useState } from 'react';
import { ROLES } from 'shared';
import type { BattleResultResponse, BattleOpponentHero } from 'shared';
import { api } from '../api/client';
import { getSubmitterToken } from '../utils/submitterToken';
import { heroPortraitUrl } from '../utils/heroIcon';
import type { DraftHeroView } from '../api/types';

const PORTRAIT_WIDTH = 130;
const PORTRAIT_HEIGHT = 81;

function PortraitCard({
  heroId,
  name,
  caption,
}: {
  heroId: number;
  name: string;
  caption?: string | null;
}) {
  return (
    <div style={{ width: PORTRAIT_WIDTH, textAlign: 'center', flexShrink: 0 }}>
      <img
        src={heroPortraitUrl(heroId)}
        alt={name}
        width={PORTRAIT_WIDTH}
        height={PORTRAIT_HEIGHT}
        style={{
          width: PORTRAIT_WIDTH,
          height: PORTRAIT_HEIGHT,
          objectFit: 'cover',
          borderRadius: 6,
          display: 'block',
        }}
      />
      <div style={{ fontSize: 12, marginTop: 4, fontWeight: 'bold' }}>{name}</div>
      {caption && <div style={{ fontSize: 10, opacity: 0.6 }}>{caption}</div>}
    </div>
  );
}

// Two rows of full portraits, ordered by role slot (Carry, Mid, Offlane,
// Soft Support, Hard Support) so the hero facing each of the user's picks
// lines up in the same column. No score/evaluation here on either side —
// Battle Mode is a separate system from the Evaluation Engine (Core Rules
// Separation) and this view is purely who's facing whom.
function FaceOff({ myHeroes, opponentHeroes }: { myHeroes: DraftHeroView[]; opponentHeroes: BattleOpponentHero[] }) {
  const roleOrder = ROLES as readonly string[];
  const sortedMine = myHeroes
    .slice()
    .sort((a, b) => roleOrder.indexOf(a.assignedRole ?? '') - roleOrder.indexOf(b.assignedRole ?? ''));

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        {sortedMine.map((h) => (
          <PortraitCard key={h.heroId} heroId={h.heroId} name={h.hero.name} caption={h.assignedRole} />
        ))}
      </div>
      <div style={{ textAlign: 'center', fontWeight: 'bold', opacity: 0.6, margin: '6px 0' }}>VS</div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
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
    <div style={{ marginTop: 24, borderTop: '1px solid #333', paddingTop: 16 }}>
      <h3>Battle Mode</h3>

      {!result && (
        <button onClick={handleFight} disabled={loading}>
          {loading ? 'Finding opponent...' : 'Enter Battle'}
        </button>
      )}

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {result && (
        <div>
          <p style={{ fontSize: 20, fontWeight: 'bold' }}>
            {result.resolvedOutcome === 'Win' ? 'Victory' : 'Defeat'} — {result.confidenceTier} confidence
          </p>

          <p style={{ textAlign: 'center', fontSize: 13, opacity: 0.7 }}>
            vs.{' '}
            {result.opponent.teamName
              ? `${result.opponent.teamName}${result.opponent.leagueName ? ` (${result.opponent.leagueName})` : ''}`
              : result.opponent.source === 'pro'
                ? 'a professional draft'
                : 'another player'}
          </p>

          <FaceOff myHeroes={heroes} opponentHeroes={result.opponent.heroes} />

          {result.advantages.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 'bold' }}>Advantages</div>
              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                {result.advantages.map((a, i) => (
                  <li key={i} style={{ fontSize: 13 }}>
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.disadvantages.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 'bold' }}>Disadvantages</div>
              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                {result.disadvantages.map((d, i) => (
                  <li key={i} style={{ fontSize: 13 }}>
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ marginTop: 8 }}>
            <div style={{ fontWeight: 'bold' }}>Explanation</div>
            <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
              {result.explanation.map((line, i) => (
                <li key={i} style={{ fontSize: 13, opacity: 0.85 }}>
                  {line}
                </li>
              ))}
            </ul>
          </div>

          {/* Reserved static banner ad slot between battles — see
              Blueprint/00-project-overview.md Monetization: banners only,
              no interstitial/rewarded triggers on the series-of-battles loop. */}
          <div
            style={{
              margin: '16px 0',
              minHeight: 90,
              border: '1px dashed #555',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#777',
              fontSize: 12,
            }}
          >
            Ad banner slot
          </div>

          <button onClick={handleFight} disabled={loading}>
            {loading ? 'Finding opponent...' : 'Fight again'}
          </button>
          <p style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Battles this visit: {battleCount}</p>
        </div>
      )}
    </div>
  );
}
