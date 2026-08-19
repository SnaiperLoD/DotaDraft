// Dota 2 Captains Mode, patch 7.40 order (Liquipedia Game Modes).
// First-pick side = Radiant in the UI. Player is first pick (assumption).
// Timers: 15s first ban phase, 30s later bans and all picks, 130s reserve.

export type CmLane = 'first' | 'second';
export type CmActionType = 'ban' | 'pick';

export interface CmStep {
  type: CmActionType;
  lane: CmLane;
  timeMs: number;
}

export const CM_RESERVE_MS = 130_000;
export const CM_BAN_PHASE1_MS = 15_000;
export const CM_STEP_MS = 30_000;

export const CM_STEPS: CmStep[] = [
  { type: 'ban', lane: 'first', timeMs: CM_BAN_PHASE1_MS },
  { type: 'ban', lane: 'first', timeMs: CM_BAN_PHASE1_MS },
  { type: 'ban', lane: 'second', timeMs: CM_BAN_PHASE1_MS },
  { type: 'ban', lane: 'second', timeMs: CM_BAN_PHASE1_MS },
  { type: 'ban', lane: 'first', timeMs: CM_BAN_PHASE1_MS },
  { type: 'ban', lane: 'second', timeMs: CM_BAN_PHASE1_MS },
  { type: 'ban', lane: 'second', timeMs: CM_BAN_PHASE1_MS },
  { type: 'pick', lane: 'first', timeMs: CM_STEP_MS },
  { type: 'pick', lane: 'second', timeMs: CM_STEP_MS },
  { type: 'ban', lane: 'first', timeMs: CM_STEP_MS },
  { type: 'ban', lane: 'first', timeMs: CM_STEP_MS },
  { type: 'ban', lane: 'second', timeMs: CM_STEP_MS },
  { type: 'pick', lane: 'second', timeMs: CM_STEP_MS },
  { type: 'pick', lane: 'first', timeMs: CM_STEP_MS },
  { type: 'pick', lane: 'first', timeMs: CM_STEP_MS },
  { type: 'pick', lane: 'second', timeMs: CM_STEP_MS },
  { type: 'pick', lane: 'second', timeMs: CM_STEP_MS },
  { type: 'pick', lane: 'first', timeMs: CM_STEP_MS },
  { type: 'ban', lane: 'first', timeMs: CM_STEP_MS },
  { type: 'ban', lane: 'second', timeMs: CM_STEP_MS },
  { type: 'ban', lane: 'first', timeMs: CM_STEP_MS },
  { type: 'ban', lane: 'second', timeMs: CM_STEP_MS },
  { type: 'pick', lane: 'first', timeMs: CM_STEP_MS },
  { type: 'pick', lane: 'second', timeMs: CM_STEP_MS },
];

export interface CmSlot {
  type: CmActionType;
  lane: CmLane;
  heroId: number | null;
}

export type CaptainsStatus = 'DRAFTING' | 'ASSIGNING_ROLES' | 'COMPLETED';

export interface CaptainsStateView {
  id: string;
  status: CaptainsStatus;
  stepIndex: number;
  current: CmStep | null;
  acting: 'player' | 'ai' | null;
  slots: CmSlot[];
  playerHeroIds: number[];
  aiHeroIds: number[];
  bannedHeroIds: number[];
  playerReserveMs: number;
  aiReserveMs: number;
  stepEndsAt: string;
  draftId: string | null;
}

export interface CaptainsActRequest {
  heroId?: number | null;
  timedOut?: boolean;
}
