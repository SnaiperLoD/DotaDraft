import { BadRequestException } from '@nestjs/common';
import {
  assertAssignRolesBody,
  assertCreateDraftBody,
  assertDraftActionBody,
  assertDraftId,
  assertPickBody,
  assertSynergyPreviewBody,
} from './request-validation';

describe('request validation', () => {
  it('accepts a well-formed create-draft body and rejects junk', () => {
    expect(assertCreateDraftBody({ seed: 1, heroId: 2, rerollUsed: false })).toEqual({
      seed: 1,
      heroId: 2,
      rerollUsed: false,
    });
    expect(() => assertCreateDraftBody({ seed: -1, heroId: 2, rerollUsed: false })).toThrow(
      BadRequestException,
    );
    expect(() => assertCreateDraftBody({ seed: 1, heroId: 1.5, rerollUsed: false })).toThrow(
      BadRequestException,
    );
    expect(() => assertCreateDraftBody({ seed: 1, heroId: 2, rerollUsed: 'yes' })).toThrow(
      BadRequestException,
    );
  });

  it('accepts UUID draft ids and rejects path junk', () => {
    const id = '2c1a0b8e-4d3f-4a11-9c22-abcdeffedcba';
    expect(assertDraftId(id)).toBe(id);
    expect(() => assertDraftId('does-not-exist')).toThrow(BadRequestException);
    expect(() => assertDraftId('../etc/passwd')).toThrow(BadRequestException);
  });

  it('validates pick / roles / battle-or-commit / synergy-preview shapes', () => {
    expect(assertPickBody({ heroId: 7 })).toEqual({ heroId: 7 });
    expect(() => assertPickBody({ heroId: 0 })).toThrow(BadRequestException);

    const roles = ['Carry', 'Mid', 'Offlane', 'Soft Support', 'Hard Support'];
    const assignments = roles.map((role, i) => ({ heroId: i + 1, role }));
    expect(assertAssignRolesBody({ assignments }).assignments).toHaveLength(5);
    expect(() => assertAssignRolesBody({ assignments: assignments.slice(0, 2) })).toThrow(
      BadRequestException,
    );

    expect(assertDraftActionBody({ draftId: '2c1a0b8e-4d3f-4a11-9c22-abcdeffedcba' }).draftId).toHaveLength(
      36,
    );
    expect(() => assertDraftActionBody({ draftId: 'draft-1' })).toThrow(BadRequestException);

    expect(
      assertSynergyPreviewBody({ pickedHeroIds: [1], candidateHeroIds: [2, 3] }).candidateHeroIds,
    ).toEqual([2, 3]);
    expect(() =>
      assertSynergyPreviewBody({
        pickedHeroIds: Array.from({ length: 11 }, (_, i) => i + 1),
        candidateHeroIds: [],
      }),
    ).toThrow(BadRequestException);
  });
});
