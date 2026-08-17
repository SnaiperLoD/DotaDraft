import { BadRequestException } from '@nestjs/common';
import { ROLES, type AssignRolesRequest, type CreateDraftRequest, type PickRequest } from 'shared';

const MAX_HERO_IDS = 10;
const DRAFT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertDraftId(id: string): string {
  if (typeof id !== 'string' || !DRAFT_ID_RE.test(id)) {
    throw new BadRequestException('Invalid draft id');
  }
  return id;
}

function assertIntId(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1_000_000) {
    throw new BadRequestException(`Invalid ${field}`);
  }
  return value;
}

function assertHeroIdList(value: unknown, field: string): number[] {
  if (!Array.isArray(value) || value.length > MAX_HERO_IDS) {
    throw new BadRequestException(`Invalid ${field}`);
  }
  return value.map((id) => assertIntId(id, field));
}

export function assertCreateDraftBody(body: unknown): CreateDraftRequest {
  if (!body || typeof body !== 'object') throw new BadRequestException('Invalid body');
  const b = body as Record<string, unknown>;
  if (typeof b.seed !== 'number' || !Number.isFinite(b.seed) || b.seed < 0 || b.seed >= 2 ** 31) {
    throw new BadRequestException('Invalid seed');
  }
  if (typeof b.rerollUsed !== 'boolean') {
    throw new BadRequestException('Invalid rerollUsed');
  }
  return { seed: b.seed, heroId: assertIntId(b.heroId, 'heroId'), rerollUsed: b.rerollUsed };
}

export function assertPickBody(body: unknown): PickRequest {
  if (!body || typeof body !== 'object') throw new BadRequestException('Invalid body');
  const b = body as Record<string, unknown>;
  return { heroId: assertIntId(b.heroId, 'heroId') };
}

export function assertAssignRolesBody(body: unknown): AssignRolesRequest {
  if (!body || typeof body !== 'object') throw new BadRequestException('Invalid body');
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.assignments) || b.assignments.length !== ROLES.length) {
    throw new BadRequestException(`Expected ${ROLES.length} role assignments`);
  }
  const assignments = b.assignments.map((row, i) => {
    if (!row || typeof row !== 'object') throw new BadRequestException(`Invalid assignment ${i}`);
    const a = row as Record<string, unknown>;
    if (typeof a.role !== 'string' || !(ROLES as readonly string[]).includes(a.role)) {
      throw new BadRequestException(`Invalid role: ${String(a.role)}`);
    }
    return { heroId: assertIntId(a.heroId, 'heroId'), role: a.role };
  });
  return { assignments };
}

export function assertDraftActionBody(body: unknown): { draftId: string } {
  if (!body || typeof body !== 'object') throw new BadRequestException('Invalid body');
  const b = body as Record<string, unknown>;
  if (typeof b.draftId !== 'string') throw new BadRequestException('Invalid draftId');
  return { draftId: assertDraftId(b.draftId) };
}

export function assertSynergyPreviewBody(body: unknown): {
  pickedHeroIds: number[];
  candidateHeroIds: number[];
} {
  if (!body || typeof body !== 'object') throw new BadRequestException('Invalid body');
  const b = body as Record<string, unknown>;
  return {
    pickedHeroIds: assertHeroIdList(b.pickedHeroIds, 'pickedHeroIds'),
    candidateHeroIds: assertHeroIdList(b.candidateHeroIds, 'candidateHeroIds'),
  };
}
