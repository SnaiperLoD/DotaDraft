import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ScreenFlash from './ScreenFlash';
import OpponentRollAnimation from './OpponentRollAnimation';
import { ROLES } from 'shared';
import type { BattleResultResponse, BattleOpponentHero, BattleMatchup } from 'shared';
import { api } from '../api/client';
import { getSubmitterToken } from '../utils/submitterToken';
import { heroPortraitUrl, heroIconUrl } from '../utils/heroIcon';
import type { DraftHeroView } from '../api/types';
import AdSlot from './AdSlot';
import './BattlePanel.css';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Procedurally generated shattered-glass web for the shutdown overlay — radial
// fractures from an off-centre impact plus a few jittered concentric rings
// connecting them, the way real glass shatters. Generated (seeded by heroId so
// it's stable per hero and varies between them) rather than hand-drawn, and it
// covers the whole portrait; BattlePanel.css gives the strokes their pale-blue
// glow. viewBox is the portrait's 130x81.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shatterPaths(heroId: number): string[] {
  const W = 130;
  const H = 81;
  const rng = mulberry32(heroId * 2654435761);
  const cx = W * (0.4 + rng() * 0.2);
  const cy = H * (0.38 + rng() * 0.2);
  const spokes = 11;
  const maxR = Math.hypot(W, H) * 0.66;
  const angles = Array.from({ length: spokes }, (_, i) => (i / spokes) * Math.PI * 2 + (rng() - 0.5) * 0.55);
  const fmt = (p: number[]) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;

  // Radial cracks: walk out from the impact with a little angular wander.
  const radial = angles.map((a) => {
    const pts: number[][] = [[cx, cy]];
    let ca = a;
    for (let s = 1; s <= 4; s++) {
      const r = maxR * (s / 4);
      ca = a + (rng() - 0.5) * 0.55;
      pts.push([cx + Math.cos(ca) * r, cy + Math.sin(ca) * r]);
    }
    return pts;
  });
  const paths = radial.map((pts) => `M${pts.map(fmt).join(' L')}`);

  // Concentric rings joining adjacent radials at a few radii.
  for (const rf of [0.32, 0.6, 0.88]) {
    const ring = radial.map((pts) => {
      const target = maxR * rf;
      let best = pts[1];
      for (const p of pts) if (Math.hypot(p[0] - cx, p[1] - cy) <= target) best = p;
      return [best[0] + (rng() - 0.5) * W * 0.06, best[1] + (rng() - 0.5) * H * 0.06];
    });
    paths.push(`M${ring.map(fmt).join(' L')} Z`);
  }
  return paths;
}

// Real win rate as a whole percent. Battle Mode normally avoids surfacing raw
// percentages (Accuracy Ceiling), but the matchup/pair rows exist precisely to
// show the number, by user request — so this is the one place it's shown.
const pct = (winRate: number) => `${Math.round(winRate * 100)}%`;

function HeroChip({ heroId, name }: { heroId: number; name: string }) {
  return (
    <span className="battle-hero-chip">
      <img src={heroIconUrl(heroId)} alt="" width={22} height={22} loading="lazy" />
      <span>{name}</span>
    </span>
  );
}

// One column of your-hero vs their-hero rows with the real win rate. `good`
// colours the number (a matchup you win vs one you lose). Each row shows the
// hero's overall real win rate then the matchup one — "49% → 60%" — so the
// swing into this specific opponent is visible, not just the absolute number.
function MatchupList({ heading, rows, good }: { heading: string; rows: BattleMatchup[]; good: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="battle-matchup-col">
      <div className="battle-list-heading">{heading}</div>
      <ul>
        {rows.map((m, i) => (
          <li key={i}>
            <span className="battle-matchup-heroes">
              <HeroChip heroId={m.heroId} name={m.hero} />
              <span className="battle-matchup-vs">{t('battle.matchupVs')}</span>
              <HeroChip heroId={m.vsId} name={m.vs} />
            </span>
            <span className="battle-matchup-wr">
              {m.baseWinRate !== null && (
                <span className="battle-matchup-base">{pct(m.baseWinRate)} → </span>
              )}
              <span className={good ? 'battle-matchup-wr--good' : 'battle-matchup-wr--bad'}>
                {pct(m.winRate)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
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
  isShutdown = false,
}: {
  heroId: number;
  name: string;
  caption?: string | null;
  // My side's caption is a role key (translated via roles.*); the
  // opponent side's caption (when present) is a real player's OpenDota
  // name — display verbatim, never run through the roles.* dictionary.
  translateCaption?: boolean;
  // Shutdown (common/shutdown.ts) — cracked-portrait visual only, on
  // whichever side this hero is being rendered on. See BattlePanel.css
  // .portrait-card--shutdown.
  isShutdown?: boolean;
}) {
  const { t } = useTranslation();
  const cracks = useMemo(() => shatterPaths(heroId), [heroId]);
  return (
    <div className={`portrait-card${isShutdown ? ' portrait-card--shutdown' : ''}`}>
      <img src={heroPortraitUrl(heroId)} alt={name} width={130} height={81} />
      {/* Shattered-glass overlay when this hero is shut down: a pale-blue,
          softly glowing fracture web spread across the whole portrait (procedural,
          BattlePanel.tsx; glow + draw-in in BattlePanel.css). */}
      {isShutdown && (
        <svg className="portrait-crack" viewBox="0 0 130 81" preserveAspectRatio="none" aria-hidden="true">
          <g className="portrait-crack-lines">
            {cracks.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </g>
          {/* pathLength intentionally not used — see BattlePanel.css crack-appear. */}
        </svg>
      )}
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
  shutdownHeroIds,
}: {
  myHeroes: DraftHeroView[];
  opponentHeroes: BattleOpponentHero[];
  collisionKey: number;
  shutdownHeroIds: number[];
}) {
  const { t } = useTranslation();
  const roleOrder = ROLES as readonly string[];
  const sortedMine = myHeroes
    .slice()
    .sort((a, b) => roleOrder.indexOf(a.assignedRole ?? '') - roleOrder.indexOf(b.assignedRole ?? ''));

  return (
    <div className="faceoff" key={collisionKey}>
      {/* Green for your side, red for theirs — Dota's own Radiant/Dire
          colour duality, which players read instantly. Deliberately NOT
          labelled "Radiant"/"Dire": these are two drafts, neither is
          actually on a side of the map, so borrowing the colours is fair
          but borrowing the names would be a lie. */}
      <div className="faceoff-side faceoff-side--mine">
        <span className="faceoff-side-label">{t('battle.sideYours')}</span>
        <div className="faceoff-row faceoff-row--mine">
          {sortedMine.map((h) => (
            <PortraitCard
              key={h.heroId}
              heroId={h.heroId}
              name={h.hero.name}
              caption={h.assignedRole}
              isShutdown={shutdownHeroIds.includes(h.heroId)}
            />
          ))}
        </div>
      </div>
      <div className="faceoff-divider">
        <span>VS</span>
      </div>
      <div className="faceoff-side faceoff-side--opponent">
        <div className="faceoff-row faceoff-row--opponent">
          {opponentHeroes.map((h) => (
            <PortraitCard
              key={h.heroId}
              heroId={h.heroId}
              name={h.heroName}
              caption={h.playerName}
              translateCaption={false}
              isShutdown={shutdownHeroIds.includes(h.heroId)}
            />
          ))}
        </div>
        <span className="faceoff-side-label">{t('battle.sideOpponent')}</span>
      </div>
    </div>
  );
}

interface Props {
  draftId: string;
  heroes: DraftHeroView[];
  // Battle Mode is a separate screen (DraftPage). `active` is true only while
  // that screen is showing; it both auto-starts the first fight on entry and
  // keeps the roll from firing while the panel is mounted-but-hidden.
  active?: boolean;
  onBack?: () => void;
}

export default function BattlePanel({ draftId, heroes, active = true, onBack }: Props) {
  const { t } = useTranslation();
  const [result, setResult] = useState<BattleResultResponse | null>(null);
  const [loading, setLoading] = useState(false);
  // The one-by-one settle phase between the request resolving and the full
  // faceoff appearing (OpponentRollAnimation). Distinct from `loading`: the
  // request is already done, we're just revealing its opponent slot by slot.
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [battleCount, setBattleCount] = useState(0);
  // Increments at the START of each fight. The roll keys on this so a single
  // fight's spin flows straight into its settle without remounting, while a
  // fresh "Fight Again" gets a clean roll.
  const [fightSeq, setFightSeq] = useState(0);

  const handleFight = async () => {
    setFightSeq((s) => s + 1);
    setLoading(true);
    setError(null);
    try {
      const [res] = await Promise.all([
        api.fightBattle(draftId, getSubmitterToken()),
        sleep(MIN_ROLL_DURATION_MS),
      ]);
      setResult(res);
      setBattleCount((c) => c + 1);
      // Hand off from the searching spin to the slot-by-slot settle; the full
      // result renders once OpponentRollAnimation calls onSettled.
      setRevealing(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Auto-start the first fight when the player crosses into the battle screen,
  // so entering Battle Mode leads straight into the roll rather than onto yet
  // another button. Re-arms when they leave, but the `!result` guard means
  // returning to a fought battle shows the existing result instead of
  // silently re-rolling a new opponent.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!active) {
      autoStartedRef.current = false;
      return;
    }
    if (!autoStartedRef.current && !result && !loading && !revealing && !error) {
      autoStartedRef.current = true;
      void handleFight();
    }
    // handleFight/result/loading/error are read as a one-shot latch here; the
    // ref is what actually guards re-entry, so this only needs to re-run when
    // `active` flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <div className="battle-panel">
      <div className="battle-screen-head">
        {onBack && (
          <button type="button" className="btn btn-ghost btn-sm battle-back" onClick={onBack}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            {t('battle.backToEvaluation')}
          </button>
        )}
        <h3>{t('battle.title')}</h3>
      </div>

      {!result && !loading && !revealing && (
        <>
          <p className="battle-screen-intro">{t('battle.screenIntro')}</p>
          <button className="btn btn-primary" onClick={() => void handleFight()} disabled={loading}>
            {t('battle.enterBattle')}
          </button>
        </>
      )}

      {/* One roll instance spans both phases: it spins while `loading`
          (opponentHeroes null = searching), then locks the real opponent in
          slot by slot once `revealing` starts, and calls onSettled to reveal
          the full result. Keyed on fightSeq so a fresh "Fight Again" restarts
          the roll while a single fight's spin→settle stays continuous. */}
      {(loading || revealing) && (
        <OpponentRollAnimation
          key={fightSeq}
          opponentHeroes={revealing ? (result?.opponent.heroes ?? null) : null}
          onSettled={() => setRevealing(false)}
        />
      )}

      {error && <p className="error-text">{error}</p>}

      {result && !loading && !revealing && (
        <div className={`battle-result battle-result--${result.resolvedOutcome === 'Win' ? 'win' : 'lose'}`}>
          <ScreenFlash outcome={result.resolvedOutcome} flashKey={battleCount} />

          {/* Outcome, confidence and opponent used to run together in one
              sentence ("Victory — Low Confidence"), which buried the single
              word the player actually came for. Three separate registers now:
              the verdict, the caveat, the who. */}
          <div
            className={`battle-verdict battle-verdict--${result.resolvedOutcome === 'Win' ? 'win' : 'lose'}`}
          >
            <span className="battle-outcome">
              {result.resolvedOutcome === 'Win' ? t('battle.victory') : t('battle.defeat')}
            </span>
            <span className={`battle-confidence battle-confidence--${result.confidenceTier.toLowerCase()}`}>
              {t('battle.confidence', { tier: t(`battle.tier.${result.confidenceTier}`) })}
            </span>
          </div>

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

          <FaceOff
            myHeroes={heroes}
            opponentHeroes={result.opponent.heroes}
            collisionKey={battleCount}
            shutdownHeroIds={result.shutdownHeroIds}
          />

          <div className="battle-lists">
            {result.shutdownNotes.length > 0 && (
              <div className="battle-list-block battle-list-block--shutdown">
                <div className="battle-list-heading">{t('battle.shutdown')}</div>
                <ul>
                  {result.shutdownNotes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            )}

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
              <div className="battle-list-block battle-list-block--good">
                <div className="battle-list-heading">{t('battle.advantages')}</div>
                <ul>
                  {result.advantages.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.disadvantages.length > 0 && (
              <div className="battle-list-block battle-list-block--bad">
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
          </div>

          {/* Real (OpenDota) win-rate rows, always from your draft's own
              perspective — your best synergy pairs, and your best/worst
              individual matchups into this opponent. Only shown when real
              data covers the heroes in play. */}
          {((result.bestPairs ?? []).length > 0 ||
            (result.bestMatchups ?? []).length > 0 ||
            (result.worstMatchups ?? []).length > 0) && (
            <>
              <p className="battle-matchups-note">{t('battle.realWinRateNote')}</p>
              <div className="battle-matchups">
                {(result.bestPairs ?? []).length > 0 && (
                  <div className="battle-matchup-col">
                    <div className="battle-list-heading">{t('battle.bestPairs')}</div>
                    <ul>
                      {(result.bestPairs ?? []).map((p, i) => (
                        <li key={i}>
                          <span className="battle-matchup-heroes">
                            <HeroChip heroId={p.heroAId} name={p.heroA} />
                            <span className="battle-matchup-vs">+</span>
                            <HeroChip heroId={p.heroBId} name={p.heroB} />
                          </span>
                          <span className="battle-matchup-wr battle-matchup-wr--good">{pct(p.winRate)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(result.bestMatchups ?? []).length > 0 && (
                  <MatchupList heading={t('battle.bestMatchups')} rows={result.bestMatchups ?? []} good />
                )}
                {(result.worstMatchups ?? []).length > 0 && (
                  <MatchupList heading={t('battle.worstMatchups')} rows={result.worstMatchups ?? []} good={false} />
                )}
              </div>
            </>
          )}

          <div className="battle-ad">
            <AdSlot size="leaderboard" />
          </div>

          <button className="btn btn-primary" onClick={() => void handleFight()} disabled={loading}>
            {loading && <span className="btn-spinner" aria-hidden="true" />}
            {loading ? t('battle.findingOpponent') : t('battle.fightAgain')}
          </button>
          <p className="battle-count">{t('battle.battlesThisVisit', { count: battleCount })}</p>
        </div>
      )}
    </div>
  );
}
