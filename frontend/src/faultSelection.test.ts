import { describe, expect, it } from 'vitest';
import { pickRandomFault } from './faultSelection';
import type { Fault } from './types';

const FAULT = (id: string, difficulty: string): Fault => ({ id, name: id, difficulty, patch: [] });

const FAULTS: Fault[] = [
  FAULT('healthy', 'n/a'),
  FAULT('r1_open', 'easy'),
  FAULT('r2_open', 'easy'),
  FAULT('r1_drift_high', 'medium'),
  FAULT('short_vin_vout', 'hard'),
];

describe('pickRandomFault', () => {
  it('never picks healthy', () => {
    for (let i = 0; i < 20; i++) {
      expect(pickRandomFault(FAULTS, 'random', () => i / 20).id).not.toBe('healthy');
    }
  });

  it('only picks faults matching the requested difficulty', () => {
    expect(pickRandomFault(FAULTS, 'medium', () => 0).id).toBe('r1_drift_high');
    expect(pickRandomFault(FAULTS, 'hard', () => 0).id).toBe('short_vin_vout');
  });

  it('can pick different faults from the same tier across calls', () => {
    const first = pickRandomFault(FAULTS, 'easy', () => 0);
    const second = pickRandomFault(FAULTS, 'easy', () => 0.99);
    expect(first.id).toBe('r1_open');
    expect(second.id).toBe('r2_open');
    expect(first.id).not.toBe(second.id);
  });

  it('falls back to the full non-healthy pool when a tier has no faults', () => {
    const noHardFaults = FAULTS.filter((f) => f.difficulty !== 'hard');
    const picked = pickRandomFault(noHardFaults, 'hard', () => 0);
    expect(picked.id).not.toBe('healthy');
  });

  it('never crashes when a device has no faults at all', () => {
    expect(() => pickRandomFault([], 'easy', () => 0)).not.toThrow();
    expect(pickRandomFault([], 'easy', () => 0).id).toBe('healthy');
  });
});
