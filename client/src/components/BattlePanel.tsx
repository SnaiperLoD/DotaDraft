import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import ScreenFlash from './ScreenFlash';
import OpponentRollAnimation from './OpponentRollAnimation';
import { ROLES, isTiFinalsOpponent, sanitizeDraftCodeInput } from 'shared';
import type {
  BattleResultResponse,
  BattleOpponentHero,
  BattleMatchup,
  BattleLaneResult,
  BattleTagChip,
} from 'shared';
import { api } from '../api/client';
import { getSubmitterToken } from '../utils/submitterToken';
import { heroPortraitUrl, heroIconUrl } from '../utils/heroIcon';
import type { DraftHeroView } from '../api/types';
import TeamCrest from './TeamCrest';
import {
  bestWinStreak,
  currentLoseStreak,
  currentWinStreak,
  runRecord,
  type FightOutcome,
} from '../utils/runStreak';
import { track } from '../telemetry';
import { formatBattleAxisLine, customTagName, customTagDescription, axisLabel } from '../i18n/display';
import { renderLocalizedLine } from '../i18n/narrative';
import { battleCoinVisibility } from '../utils/battleCoinVisibility';
import ArchetypeSeal from './ArchetypeSeal';
import DraftLedger from './DraftLedger';
import CoinFlip3D from './CoinFlip3D';
import './BattlePanel.css';

const COIN_FACEOFF_MS = 1600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Bold every hero name that appears in a battle-outcome sentence (user
// request): the portraits in the two drafts are already bold, so the write-up
// should match. `heroNames` is both teams' heroes. Longest names first so a
// multi-word name (e.g. "Ancient Apparition") wins over a shorter name that is
// a substring of it before the shorter one can split it.
function boldHeroNames(text: string, heroNames: string[]): ReactNode {
  if (heroNames.length === 0) return text;
  const unique = [...new Set(heroNames)].sort((a, b) => b.length - a.length);
  const nameSet = new Set(unique);
  const parts = text.split(new RegExp(`(${unique.map(escapeRegExp).join('|')})`, 'g'));
  return parts.map((part, i) => (nameSet.has(part) ? <strong key={i}>{part}</strong> : part));
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
// percentages (Accuracy Ceiling), but the matchup/pair rows and lane cards
// exist precisely to show the number, by user request — so this is the one
// place it's shown.
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
              {m.baseWinRate !== null && <span className="battle-matchup-base">{pct(m.baseWinRate)} → </span>}
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

function LaneMatchups({ lanes }: { lanes: BattleLaneResult[] }) {
  const { t } = useTranslation();
  if (lanes.length === 0) return null;

  return (
    <div className="battle-lanes" data-testid="battle-lanes">
      {lanes.map((lane) => {
        const winnerLabel =
          lane.winner === 'mine'
            ? t('battle.laneWinnerYours')
            : lane.winner === 'opponent'
              ? t('battle.laneWinnerOpponent')
              : t('battle.laneEven');
        const chance =
          lane.winRate === null
            ? null
            : lane.winner === 'opponent'
              ? pct(1 - lane.winRate)
              : pct(lane.winRate);
        const chanceClass =
          lane.winner === 'mine'
            ? 'battle-matchup-wr--good'
            : lane.winner === 'opponent'
              ? 'battle-matchup-wr--bad'
              : undefined;
        return (
          <div
            key={lane.lane}
            className="battle-lane-card"
            data-testid="battle-lane-card"
            data-lane={lane.lane}
            data-winner={lane.winner}
          >
            <div className="battle-lane-label">{t(`battle.story.lanes.${lane.lane}`)}</div>
            <div className="battle-lane-heroes">
              <span className="battle-lane-side">
                {lane.mine.map((name, i) => (
                  <HeroChip key={`m-${lane.mineIds[i] ?? name}`} heroId={lane.mineIds[i] ?? 0} name={name} />
                ))}
              </span>
              <span className="battle-lane-vs">{t('battle.matchupVs')}</span>
              <span className="battle-lane-side">
                {lane.opponent.map((name, i) => (
                  <HeroChip
                    key={`o-${lane.opponentIds[i] ?? name}`}
                    heroId={lane.opponentIds[i] ?? 0}
                    name={name}
                  />
                ))}
              </span>
            </div>
            <div className="battle-lane-result">
              <span>{winnerLabel}</span>
              {chance !== null && <span className={chanceClass}>{chance}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BattleStory({ result, heroNames }: { result: BattleResultResponse; heroNames: string[] }) {
  const { t } = useTranslation();
  const story = result.story;
  if (!story?.beats.length) return null;

  return (
    <div className="battle-story" data-testid="battle-story">
      <div className="battle-story-head">
        <div className="battle-list-heading">{t('battle.story.title')}</div>
        <span>{t('battle.story.disclaimer')}</span>
      </div>
      <div className="battle-story-timeline">
        {story.beats.map((beat) => {
          const winner = t(
            beat.params.winnerSide === 'opponent' ? 'battle.story.opponentSide' : 'battle.story.yourSide',
          );
          const interpolated: Record<string, string> = {
            ...beat.params,
            winner,
            topAxis: beat.params.topAxis
              ? t(`battle.story.axes.${beat.params.topAxis}`, {
                  defaultValue: beat.params.topAxis,
                })
              : '',
            openingLane: beat.params.openingLane
              ? t(`battle.story.laneFull.${beat.params.openingLane}`, {
                  defaultValue: beat.params.openingLane,
                })
              : '',
            posture:
              beat.params.posture === 'behind' || beat.params.posture === 'upset'
                ? t(`battle.story.posture.${beat.params.posture}`)
                : '',
          };
          const chunks: string[] = [t(`battle.story.${beat.key}`, interpolated)];
          if (beat.phase === 'opening' && interpolated.openingPairHero && interpolated.openingPairVs) {
            chunks.push(t('battle.story.openingLaneHook', interpolated));
          }
          if (beat.phase === 'opening' && interpolated.theirDriver) {
            chunks.push(t('battle.story.answerLine', interpolated));
          }
          if (beat.phase === 'opening' && interpolated.turner) {
            chunks.push(t('battle.story.turnerLine', interpolated));
          }
          const leadKey = `${beat.phase}Lead`;
          const lead = beat.params[leadKey];
          if (beat.phase === 'conversion') {
            chunks.push(t('battle.story.pitWindowOnly'));
          } else if (lead === 'yours' || lead === 'theirs' || lead === 'even') {
            chunks.push(t(`battle.story.lead.${lead}`));
          }
          if (story.thinPhase && story.thinPhase === beat.phase) {
            chunks.push(t('battle.story.thinHere'));
          }
          if (beat.phase === 'finish') {
            chunks.push(t('battle.story.noRamp'));
            if (interpolated.myCarry && interpolated.theirCarry) {
              if (interpolated.lateMatchupWinner && interpolated.carryWinRate) {
                chunks.push(t('battle.story.carryLateMatchup', interpolated));
              } else {
                chunks.push(t('battle.story.carryLate', interpolated));
              }
              if (interpolated.scaleLeader) {
                chunks.push(t('battle.story.carryScale', interpolated));
              }
            }
          }
          return (
            <div
              key={beat.phase}
              className="battle-story-beat"
              data-testid="battle-story-beat"
              data-phase={beat.phase}
            >
              <span className="battle-story-phase">{t(`battle.story.phases.${beat.phase}`)}</span>
              <p>{boldHeroNames(chunks.join(' '), heroNames)}</p>
            </div>
          );
        })}
      </div>
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

// Tiny trophy mark for a The International grand-finals opponent.
// Detection is match-id based (isTiFinalsOpponent) — not leagueName.
function TiFinalsMark() {
  const { t } = useTranslation();
  const label = t('battle.tiFinals');
  return (
    <span
      className="battle-ti-finals"
      title={label}
      aria-label={label}
      role="img"
      data-testid="battle-ti-finals"
    >
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
        <path
          d="M3.2 2.2h9.6v1.4c0 2.7-2.15 4.9-4.8 4.9S3.2 6.3 3.2 3.6V2.2Z"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinejoin="round"
        />
        <path
          d="M3.2 3.4H2.1A2.1 2.1 0 0 0 4.2 5.5"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
        />
        <path
          d="M12.8 3.4h1.1A2.1 2.1 0 0 1 11.8 5.5"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
        />
        <path d="M8 8.5v2.2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        <path d="M5.6 12.4h4.8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        <path d="M4.8 14.2h6.4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      </svg>
    </span>
  );
}

// Two rows of full portraits, ordered by role slot (Carry, Mid, Offlane,
// Soft Support, Hard Support) so the hero facing each of the user's picks
// lines up in the same column. Archetype seals are Evaluate's display
// headline (Tempo / Late / 4+1) — not Battle math.
// collisionKey remounts both rows (React key trick, same pattern as
// ScreenFlash's flashKey) so the slide-in-and-clash animation replays on
// every fight, not just the first one. Blueprint/10-tech-debt-backlog.md,
function BattleTagChips({
  chips,
  mineNames,
  opponentNames,
}: {
  chips: BattleTagChip[];
  mineNames: string[];
  opponentNames: string[];
}) {
  const { t } = useTranslation();
  if (chips.length === 0) return null;

  const renderChip = (chip: BattleTagChip) => (
    <li key={`${chip.side}-${chip.name}`} className="battle-tag-chip">
      <span className={`hero-tag-badge rarity-${chip.rarity}`}>{customTagName(t, chip.name)}</span>
      {chip.name === 'The Fundamentals' && chip.fundamentalsAxes && chip.fundamentalsAxes.length > 0 && (
        <span className="fundamentals-axis-row">
          <span className="fundamentals-axis-label">{t('evaluation.fundamentalsBoosts')}</span>
          {chip.fundamentalsAxes.map((axis) => (
            <span key={axis} className="fundamentals-axis-chip">
              {axisLabel(t, axis)}
            </span>
          ))}
        </span>
      )}
      <span className="battle-tag-chip-effect">
        {customTagDescription(
          t,
          { name: chip.name, description: '' },
          {
            teamHeroNames: chip.side === 'mine' ? mineNames : opponentNames,
            fundamentalsAxes: chip.fundamentalsAxes,
          },
        )}
      </span>
    </li>
  );

  const mine = chips.filter((c) => c.side === 'mine');
  const opponent = chips.filter((c) => c.side === 'opponent');

  return (
    <div className="battle-tag-chips panel">
      <div className="battle-tag-chips-heading">{t('battle.tagChipsTitle')}</div>
      {mine.length > 0 && (
        <>
          <div className="battle-tag-chips-side">{t('battle.tagChipsMine')}</div>
          <ul>{mine.map(renderChip)}</ul>
        </>
      )}
      {opponent.length > 0 && (
        <>
          <div className="battle-tag-chips-side">{t('battle.tagChipsOpponent')}</div>
          <ul>{opponent.map(renderChip)}</ul>
        </>
      )}
    </div>
  );
}

// "Анимация столкновения в Battle" — first-pass draft: each row slides in
// from its own side and the impact beat is timed to land under
// ScreenFlash's flash rather than choreographed against it precisely.
function FaceOff({
  myHeroes,
  opponentHeroes,
  collisionKey,
  shutdownHeroIds,
  tiFinals,
  mineArchetypeId,
  opponentArchetypeId,
  opponentTeam,
}: {
  myHeroes: DraftHeroView[];
  opponentHeroes: BattleOpponentHero[];
  collisionKey: number;
  shutdownHeroIds: number[];
  tiFinals: boolean;
  mineArchetypeId: string | null | undefined;
  opponentArchetypeId: string | null | undefined;
  opponentTeam?: string | null;
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
        <span className="faceoff-side-label">
          {t('battle.sideYours')}
          <ArchetypeSeal archetypeId={mineArchetypeId} compact side="mine" />
        </span>
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
        <span className="faceoff-side-label">
          {opponentTeam && <TeamCrest name={opponentTeam} size={20} />}
          {t('battle.sideOpponent')}
          <ArchetypeSeal archetypeId={opponentArchetypeId} compact side="opponent" />
          {tiFinals && <TiFinalsMark />}
        </span>
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
  variant?: 'pool' | 'once';
  autoStart?: boolean;
  captainsSessionId?: string;
  tiRunId?: string;
  backLabel?: string;
  onFought?: (result: BattleResultResponse) => void;
}

export default function BattlePanel({
  draftId,
  heroes,
  active = true,
  onBack,
  variant = 'pool',
  autoStart,
  captainsSessionId,
  tiRunId,
  backLabel,
  onFought,
}: Props) {
  const shouldAutoStart = autoStart ?? variant === 'pool';
  const { t } = useTranslation();
  const [result, setResult] = useState<BattleResultResponse | null>(null);
  const [loading, setLoading] = useState(false);
  // The one-by-one settle phase between the request resolving and the full
  // faceoff appearing (OpponentRollAnimation). Distinct from `loading`: the
  // request is already done, we're just revealing its opponent slot by slot.
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [battleCount, setBattleCount] = useState(0);
  // Chronological outcomes for this Battle Mode visit (the "run"). Resets when
  // BattlePanel remounts — i.e. a new draft — not when bouncing back to Eval.
  // Appended only after OpponentRollAnimation settles — never while the roll
  // is still spinning, or the header chip spoils the verdict.
  const [runOutcomes, setRunOutcomes] = useState<FightOutcome[]>([]);
  const pendingRunOutcomeRef = useRef<FightOutcome | null>(null);
  // Increments at the START of each fight. The roll keys on this so a single
  // fight's spin flows straight into its settle without remounting, while a
  // fresh "Fight Again" gets a clean roll.
  const [fightSeq, setFightSeq] = useState(0);
  const [pasteText, setPasteText] = useState('');
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [coinPhase, setCoinPhase] = useState<'faceoff' | 'spin' | 'done' | null>(null);
  const resultRef = useRef<BattleResultResponse | null>(null);
  const coinLandedRef = useRef(false);

  // Both drafts' hero names, for bolding them in the outcome write-up (same as
  // the portraits). Empty until a fight resolves.
  const battleHeroNames = useMemo(
    () =>
      result ? [...heroes.map((h) => h.hero.name), ...result.opponent.heroes.map((h) => h.heroName)] : [],
    [heroes, result],
  );

  useEffect(() => {
    resultRef.current = result;
  }, [result]);

  const handleFight = async (opts: { copiedDraft?: string } = {}) => {
    const fightIndex = battleCount;
    setFightSeq((s) => s + 1);
    setCoinPhase(null);
    coinLandedRef.current = false;
    setLoading(true);
    setError(null);
    track(
      'battle_fight',
      { n: fightIndex + 1, auto: fightIndex === 0, challenge: !!opts.copiedDraft, variant },
      draftId,
    );
    try {
      const [res] = await Promise.all([
        api.fightBattle(draftId, getSubmitterToken(), {
          ...opts,
          ...(captainsSessionId ? { captainsSessionId } : {}),
          ...(tiRunId ? { tiRunId } : {}),
        }),
        sleep(MIN_ROLL_DURATION_MS),
      ]);
      setResult(res);
      resultRef.current = res;
      setBattleCount((c) => c + 1);
      pendingRunOutcomeRef.current =
        res.resolvedOutcome === 'Win' || res.resolvedOutcome === 'Lose' ? res.resolvedOutcome : null;
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
    if (!autoStartedRef.current && !result && !loading && !revealing && !error && shouldAutoStart) {
      autoStartedRef.current = true;
      void handleFight();
    }
    // handleFight/result/loading/error are read as a one-shot latch here; the
    // ref is what actually guards re-entry, so this only needs to re-run when
    // `active` flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (coinPhase !== 'faceoff') return;
    const t = window.setTimeout(() => setCoinPhase('spin'), COIN_FACEOFF_MS);
    return () => window.clearTimeout(t);
  }, [coinPhase]);

  const settleCoin = () => {
    if (coinLandedRef.current) return;
    coinLandedRef.current = true;
    setCoinPhase('done');
    const pending = pendingRunOutcomeRef.current;
    const res = resultRef.current;
    if (pending) {
      pendingRunOutcomeRef.current = null;
      setRunOutcomes((prev) => [...prev, pending]);
      track(
        'battle_outcome',
        {
          outcome: pending,
          confidenceTier: res?.confidenceTier ?? null,
          opponentSource: res?.opponent.source ?? null,
          coinFlip: true,
        },
        draftId,
      );
      if (res) onFought?.(res);
    }
  };

  // When the fight resolves (the settle finishes and the verdict appears),
  // jump the page to the top so the Victory/Defeat headline is what the player
  // lands on — the roll leaves them scrolled down (user). Keyed on battleCount
  // so it fires once per fight, only after the reveal (not during the roll).
  useEffect(() => {
    if (
      battleCount > 0 &&
      result &&
      !loading &&
      !revealing &&
      coinPhase !== 'faceoff' &&
      coinPhase !== 'spin'
    ) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealing, battleCount, coinPhase]);

  const { wins: runWins, losses: runLosses } = runRecord(runOutcomes);
  const winStreak = currentWinStreak(runOutcomes);
  const loseStreak = currentLoseStreak(runOutcomes);
  const peakWinStreak = bestWinStreak(runOutcomes);
  const tiFinals = isTiFinalsOpponent(result?.opponent);
  const inCeremony = loading || revealing || coinPhase === 'faceoff' || coinPhase === 'spin';
  const { showCoinFaceoff, showCoin, showStandardResult } = battleCoinVisibility({
    result,
    loading,
    revealing,
    coinPhase,
  });

  return (
    <div className="battle-panel">
      <div className="battle-screen-head">
        {onBack && (
          <button type="button" className="btn btn-ghost btn-sm battle-back" onClick={onBack}>
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            {backLabel ?? t('battle.backToEvaluation')}
          </button>
        )}
        <h3>{t('battle.title')}</h3>
        {runOutcomes.length > 0 && (
          <div className="battle-run-chip" title={t('battle.runHint')} data-testid="battle-run-chip">
            <span className="battle-run-record">
              <span className="battle-run-win">
                {runWins}
                {t('history.winShort')}
              </span>
              <span className="battle-run-sep">–</span>
              <span className="battle-run-lose">
                {runLosses}
                {t('history.lossShort')}
              </span>
            </span>
            {winStreak >= 2 && (
              <span className="battle-run-streak battle-run-streak--win">
                {t('battle.winStreak', { count: winStreak })}
              </span>
            )}
            {loseStreak >= 2 && (
              <span className="battle-run-streak battle-run-streak--lose">
                {t('battle.loseStreak', { count: loseStreak })}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="completed-head">
        <DraftLedger heroes={heroes} totalSlots={5} title={t('draft.yourTeam')} layout="rail" />
        <div className="completed-head-actions">
          {!(variant === 'once' && result) && (
            <button
              className="btn btn-primary completed-head-fight"
              onClick={() => void handleFight()}
              disabled={inCeremony}
            >
              {(loading || revealing) && <span className="btn-spinner" aria-hidden="true" />}
              {loading || revealing
                ? t('battle.findingOpponent')
                : result
                  ? t('battle.fightAgain')
                  : t('battle.enterBattle')}
            </button>
          )}
          {variant === 'pool' && !inCeremony && (
            <button
              type="button"
              className="btn btn-secondary btn-sm battle-challenge-toggle"
              data-testid="battle-challenge-toggle"
              aria-expanded={challengeOpen}
              onClick={() => setChallengeOpen((open) => !open)}
            >
              {t('battle.challengeTitle')}
            </button>
          )}
          {variant === 'pool' && challengeOpen && !inCeremony && (
            <form
              className="battle-challenge-row"
              data-testid="battle-challenge-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (pasteText.trim()) void handleFight({ copiedDraft: pasteText });
              }}
            >
              <input
                className="battle-challenge-paste"
                data-testid="battle-challenge-paste"
                size={1}
                value={pasteText}
                onChange={(e) => setPasteText(sanitizeDraftCodeInput(e.target.value))}
                onPaste={(e) => {
                  e.preventDefault();
                  setPasteText(sanitizeDraftCodeInput(e.clipboardData.getData('text/plain')));
                }}
                placeholder={t('battle.challengePaste')}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                autoFocus
                aria-label={t('battle.challengePaste')}
                title={t('battle.challengeHint')}
              />
              <button
                type="submit"
                className="btn btn-secondary btn-sm"
                disabled={pasteText.trim().length === 0}
              >
                {t('battle.challengeFight')}
              </button>
            </form>
          )}
        </div>
      </div>

      {!result && !loading && !revealing && <p className="battle-screen-intro">{t('battle.screenIntro')}</p>}

      {/* One roll instance spans both phases: it spins while `loading`
          (opponentHeroes null = searching), then locks the real opponent in
          slot by slot once `revealing` starts, and calls onSettled to reveal
          the full result. Keyed on fightSeq so a fresh "Fight Again" restarts
          the roll while a single fight's spin→settle stays continuous. */}
      {(loading || revealing) && (
        <OpponentRollAnimation
          key={fightSeq}
          opponentHeroes={revealing ? (result?.opponent.heroes ?? null) : null}
          onSettled={() => {
            const res = resultRef.current;
            if (res?.coinFlip) {
              setRevealing(false);
              setCoinPhase('faceoff');
              return;
            }
            setRevealing(false);
            const pending = pendingRunOutcomeRef.current;
            if (pending) {
              pendingRunOutcomeRef.current = null;
              setRunOutcomes((prev) => [...prev, pending]);
              track(
                'battle_outcome',
                {
                  outcome: pending,
                  confidenceTier: result?.confidenceTier ?? null,
                  opponentSource: result?.opponent.source ?? null,
                },
                draftId,
              );
              if (result) onFought?.(result);
            }
          }}
        />
      )}

      {error && <p className="error-text">{error}</p>}

      {showCoinFaceoff && result && (
        <div data-testid="battle-coin-faceoff">
          <FaceOff
            myHeroes={heroes}
            opponentHeroes={result.opponent.heroes}
            collisionKey={battleCount}
            shutdownHeroIds={result.shutdownHeroIds}
            tiFinals={tiFinals}
            mineArchetypeId={result.archetype?.id}
            opponentArchetypeId={result.opponent.archetype?.id}
            opponentTeam={result.opponent.source === 'pro' ? result.opponent.teamName : null}
          />
        </div>
      )}

      {showCoin && result && (
        <div className="battle-coin-stage">
          <CoinFlip3D outcome={result.resolvedOutcome} onLanded={settleCoin} />
          {coinPhase === 'done' && (
            <>
              <p
                className={`battle-coin-verdict battle-coin-verdict--${result.resolvedOutcome === 'Win' ? 'win' : 'lose'}`}
                data-testid="battle-coin-verdict"
                data-outcome={result.resolvedOutcome}
              >
                {result.resolvedOutcome === 'Win' ? t('battle.youWin') : t('battle.youLose')}
              </p>
              <p className="battle-coin-note">{t('battle.coinFlipNote')}</p>
            </>
          )}
        </div>
      )}

      {showStandardResult && result && (
        <div
          className={`battle-result bracketed battle-result--${result.resolvedOutcome === 'Win' ? 'win' : 'lose'}`}
        >
          <ScreenFlash outcome={result.resolvedOutcome} flashKey={battleCount} />

          {/* Outcome, confidence and opponent used to run together in one
              sentence ("Victory — Low Confidence"), which buried the single
              word the player actually came for. Three separate registers now:
              the verdict, the caveat, the who. */}
          <div
            className={`battle-verdict battle-verdict--${result.resolvedOutcome === 'Win' ? 'win' : 'lose'}`}
            data-testid="battle-verdict"
            data-outcome={result.resolvedOutcome}
          >
            <span className="battle-outcome">
              {result.resolvedOutcome === 'Win' ? t('battle.victory') : t('battle.defeat')}
            </span>
            <span className={`battle-confidence battle-confidence--${result.confidenceTier.toLowerCase()}`}>
              {t('battle.confidence', { tier: t(`battle.tier.${result.confidenceTier}`) })}
            </span>
          </div>

          <p className="battle-vs">
            {t('battle.vs')} {tiFinals && <TiFinalsMark />}
            {result.opponent.teamName && <TeamCrest name={result.opponent.teamName} size={22} />}
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
            tiFinals={tiFinals}
            mineArchetypeId={result.archetype?.id}
            opponentArchetypeId={result.opponent.archetype?.id}
            opponentTeam={result.opponent.source === 'pro' ? result.opponent.teamName : null}
          />

          <BattleTagChips
            chips={result.tagChips ?? []}
            mineNames={heroes.map((h) => h.hero.name)}
            opponentNames={result.opponent.heroes.map((h) => h.heroName)}
          />

          <LaneMatchups lanes={result.lanes ?? []} />

          {/* Outcome write-up: hero names bolded via boldHeroNames the same way
              the portraits above are already bold (battleHeroNames, user request). */}
          <div className="battle-lists">
            {result.shutdownHeroIds.length > 0 && (
              <div className="battle-list-block battle-list-block--shutdown">
                <div className="battle-list-heading">{t('battle.shutdown')}</div>
                <p className="battle-shutdown-blurb">{t('battle.shutdownBlurb')}</p>
                <ul>
                  {heroes
                    .filter((h) => result.shutdownHeroIds.includes(h.heroId))
                    .map((h) => (
                      <li key={`mine-${h.heroId}`}>
                        {boldHeroNames(t('battle.shutdownNoteMine', { hero: h.hero.name }), battleHeroNames)}
                      </li>
                    ))}
                  {result.opponent.heroes
                    .filter((h) => result.shutdownHeroIds.includes(h.heroId))
                    .map((h) => (
                      <li key={`opp-${h.heroId}`}>
                        {boldHeroNames(
                          t('battle.shutdownNoteOpponent', { hero: h.heroName }),
                          battleHeroNames,
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            )}

            {result.winningHighlights.length > 0 && (
              <div className="battle-list-block battle-list-block--deciding">
                <div className="battle-list-heading">{t('battle.decidingFactors')}</div>
                <ul>
                  {result.winningHighlights.map((h, i) => (
                    <li key={i}>{boldHeroNames(renderLocalizedLine(t, h), battleHeroNames)}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.advantages.length > 0 && (
              <div className="battle-list-block battle-list-block--good">
                <div className="battle-list-heading">{t('battle.advantages')}</div>
                <ul>
                  {result.advantages.map((a, i) => (
                    <li key={i}>{boldHeroNames(formatBattleAxisLine(t, a, 'advantage'), battleHeroNames)}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.disadvantages.length > 0 && (
              <div className="battle-list-block battle-list-block--bad">
                <div className="battle-list-heading">{t('battle.disadvantages')}</div>
                <ul>
                  {result.disadvantages.map((d, i) => (
                    <li key={i}>
                      {boldHeroNames(formatBattleAxisLine(t, d, 'disadvantage'), battleHeroNames)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="battle-list-block battle-list-block--explanation">
              <div className="battle-list-heading">{t('battle.explanation')}</div>
              <p className="battle-explanation-blurb">{t('battle.explanationBlurb')}</p>
              <div className="battle-explanation-prose">
                {result.explanation.map((line, i) => (
                  <p key={i}>{boldHeroNames(renderLocalizedLine(t, line), battleHeroNames)}</p>
                ))}
              </div>
              <BattleStory result={result} heroNames={battleHeroNames} />
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
                  <MatchupList
                    heading={t('battle.worstMatchups')}
                    rows={result.worstMatchups ?? []}
                    good={false}
                  />
                )}
              </div>
            </>
          )}
        </div>
      )}

      {!(variant === 'once' && result) && (
        <div className="completed-actions">
          <button className="btn btn-primary" onClick={() => void handleFight()} disabled={inCeremony}>
            {(loading || revealing) && <span className="btn-spinner" aria-hidden="true" />}
            {loading || revealing
              ? t('battle.findingOpponent')
              : result
                ? t('battle.fightAgain')
                : t('battle.enterBattle')}
          </button>
        </div>
      )}
      {result && !loading && !revealing && (
        <p className="battle-count">
          {t('battle.battlesThisVisit', { count: battleCount })}
          {peakWinStreak >= 2 && (
            <>
              {' · '}
              {t('battle.bestWinStreak', { count: peakWinStreak })}
            </>
          )}
        </p>
      )}
    </div>
  );
}
