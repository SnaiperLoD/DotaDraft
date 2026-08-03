import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ScreenFlash from './ScreenFlash';
import OpponentRollAnimation from './OpponentRollAnimation';
import { ROLES } from 'shared';
import type { BattleResultResponse, BattleOpponentHero } from 'shared';
import { api } from '../api/client';
import { getSubmitterToken } from '../utils/submitterToken';
import { heroPortraitUrl } from '../utils/heroIcon';
import type { DraftHeroView } from '../api/types';
import AdSlot from './AdSlot';
import './BattlePanel.css';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Blueprint/10-tech-debt-backlog.md, "Анимация подбора оппонента" — the
// real API call resolves near-instantly, so without a floor the roll
// animation would just flash and disappear rather than read as "finding an
// opponent." Runs in parallel with the real request, not sequentially
// after it — a slow request never waits on this on top of its own latency.
const MIN_ROLL_DURATION_MS = 1200;

function PortraitCard({
  heroId,
  name,
  caption,
  translateCaption = true,
}: {
  heroId: number;
  name: string;
  caption?: string | null;
  // My side's caption is a role key (translated via roles.*); the
  // opponent side's caption (when present) is a real player's OpenDota
  // name — display verbatim, never run through the roles.* dictionary.
  translateCaption?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="portrait-card">
      <img src={heroPortraitUrl(heroId)} alt={name} width={130} height={81} />
      <div className="name">{name}</div>
      {caption && <div className="caption">{translateCaption ? t(`roles.${caption}`) : caption}</div>}
    </div>
  );
}

// Two rows of full portraits, ordered by role slot (Carry, Mid, Offlane,
// Soft Support, Hard Support) so the hero facing each of the user's picks
// lines up in the same column. No score/evaluation here on either side —
// Battle Mode is a separate system from the Evaluation Engine (Core Rules
// Separation) and this view is purely who's facing whom.
// collisionKey remounts both rows (React key trick, same pattern as
// ScreenFlash's flashKey) so the slide-in-and-clash animation replays on
// every fight, not just the first one. Blueprint/10-tech-debt-backlog.md,
// "Анимация столкновения в Battle" — first-pass draft: each row slides in
// from its own side and the impact beat is timed to land under
// ScreenFlash's flash rather than choreographed against it precisely.
function FaceOff({
  myHeroes,
  opponentHeroes,
  collisionKey,
}: {
  myHeroes: DraftHeroView[];
  opponentHeroes: BattleOpponentHero[];
  collisionKey: number;
}) {
  const roleOrder = ROLES as readonly string[];
  const sortedMine = myHeroes
    .slice()
    .sort((a, b) => roleOrder.indexOf(a.assignedRole ?? '') - roleOrder.indexOf(b.assignedRole ?? ''));

  return (
    <div className="faceoff" key={collisionKey}>
      <div className="faceoff-row faceoff-row--mine">
        {sortedMine.map((h) => (
          <PortraitCard key={h.heroId} heroId={h.heroId} name={h.hero.name} caption={h.assignedRole} />
        ))}
      </div>
      <div className="faceoff-divider">VS</div>
      <div className="faceoff-row faceoff-row--opponent">
        {opponentHeroes.map((h) => (
          <PortraitCard key={h.heroId} heroId={h.heroId} name={h.heroName} caption={h.playerName} translateCaption={false} />
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
  const { t } = useTranslation();
  const [result, setResult] = useState<BattleResultResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [battleCount, setBattleCount] = useState(0);

  const handleFight = async () => {
    setLoading(true);
    setError(null);
    try {
      const [res] = await Promise.all([api.fightBattle(draftId, getSubmitterToken()), sleep(MIN_ROLL_DURATION_MS)]);
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
      <h3>{t('battle.title')}</h3>

      {!result && (
        <button className="btn btn-primary" onClick={() => void handleFight()} disabled={loading}>
          {loading ? t('battle.findingOpponent') : t('battle.enterBattle')}
        </button>
      )}

      {/* Shown on both the first fight and every "Fight Again" reroll —
          loading is independent of whether a previous result is still on
          screen underneath. */}
      {loading && <OpponentRollAnimation />}

      {error && <p className="error-text">{error}</p>}

      {result && !loading && (
        <div className="battle-result">
          <ScreenFlash outcome={result.resolvedOutcome} flashKey={battleCount} />
          <p className="battle-outcome">
            {result.resolvedOutcome === 'Win' ? t('battle.victory') : t('battle.defeat')} —{' '}
            {t('battle.confidence', { tier: t(`battle.tier.${result.confidenceTier}`) })}
          </p>

          <p className="battle-vs">
            {t('battle.vs')}{' '}
            {result.opponent.teamName
              ? `${result.opponent.teamName}${result.opponent.leagueName ? ` (${result.opponent.leagueName})` : ''}`
              : result.opponent.source === 'pro'
                ? t('battle.proDraft')
                : t('battle.anotherPlayer')}
            {result.opponent.matchId && (
              <>
                {' '}
                <a
                  className="battle-match-link"
                  href={`https://www.opendota.com/matches/${result.opponent.matchId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('battle.viewMatch')}
                </a>
              </>
            )}
          </p>

          <FaceOff myHeroes={heroes} opponentHeroes={result.opponent.heroes} collisionKey={battleCount} />

          {result.winningHighlights.length > 0 && (
            <div className="battle-list-block">
              <div className="battle-list-heading">{t('battle.decidingFactors')}</div>
              <ul>
                {result.winningHighlights.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            </div>
          )}

          {result.advantages.length > 0 && (
            <div className="battle-list-block">
              <div className="battle-list-heading">{t('battle.advantages')}</div>
              <ul>
                {result.advantages.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          {result.disadvantages.length > 0 && (
            <div className="battle-list-block">
              <div className="battle-list-heading">{t('battle.disadvantages')}</div>
              <ul>
                {result.disadvantages.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="battle-list-block">
            <div className="battle-list-heading">{t('battle.explanation')}</div>
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
            {loading ? t('battle.findingOpponent') : t('battle.fightAgain')}
          </button>
          <p className="battle-count">{t('battle.battlesThisVisit', { count: battleCount })}</p>
        </div>
      )}
    </div>
  );
}
