import { CM_STEPS, type CmLane, type CmSlot, type CmStep } from 'shared';

export function invertCmLane(lane: CmLane): CmLane {
  return lane === 'first' ? 'second' : 'first';
}

export function cmStepsForPlayer(playerIsFirst: boolean): CmStep[] {
  if (playerIsFirst) return CM_STEPS;
  return CM_STEPS.map((step) => ({ ...step, lane: invertCmLane(step.lane) }));
}

export function emptyCmSlots(playerIsFirst: boolean): CmSlot[] {
  return cmStepsForPlayer(playerIsFirst).map((step) => ({
    type: step.type,
    lane: step.lane,
    heroId: null,
  }));
}

export function currentCmStep(slots: CmSlot[], stepIndex: number): CmStep | null {
  if (stepIndex >= CM_STEPS.length) return null;
  return cmStepsForPlayer(slots[0]?.lane !== 'second')[stepIndex] ?? null;
}
