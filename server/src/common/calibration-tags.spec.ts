import { calibrationMultipliersForTeam, teamHasHiddenCalibrationTags } from './calibration-tags';
import { makeHero } from '../test-utils/hero-factory';

describe('calibrationMultipliersForTeam — divergence-fix buffs', () => {
  it('applies Raid Boss +18% personal power', () => {
    const medusa = makeHero({ id: 1, name: 'Medusa' });
    const m = calibrationMultipliersForTeam([medusa]).get(medusa.id)!;
    expect(m.power).toBeCloseTo(1.18);
  });

  it('applies Disable Battery +25% personal power', () => {
    const disruptor = makeHero({ id: 1, name: 'Disruptor' });
    const m = calibrationMultipliersForTeam([disruptor]).get(disruptor.id)!;
    expect(m.power).toBeCloseTo(1.25);
  });

  it('applies Haunt Absolute +12% personal power', () => {
    const spectre = makeHero({ id: 1, name: 'Spectre' });
    const m = calibrationMultipliersForTeam([spectre]).get(spectre.id)!;
    expect(m.power).toBeCloseTo(1.12);
  });

  it('applies Siege Voltage +12% personal power', () => {
    const lina = makeHero({ id: 1, name: 'Lina' });
    const m = calibrationMultipliersForTeam([lina]).get(lina.id)!;
    expect(m.power).toBeCloseTo(1.12);
  });

  it('flags hiddenCalibrationApplied for a Raid Boss carrier', () => {
    const pa = makeHero({ id: 44, name: 'Phantom Assassin' });
    expect(teamHasHiddenCalibrationTags([pa])).toBe(true);
  });
});
