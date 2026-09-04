import { describe, expect, it } from 'vitest';
import { toggleProbe, visibleResult } from './probeSelection';

describe('toggleProbe', () => {
  it('adds a probe to an empty selection', () => {
    expect(toggleProbe([], 'TP1')).toEqual(['TP1']);
  });

  it('adds a second, distinct probe', () => {
    expect(toggleProbe(['TP1'], 'TP2')).toEqual(['TP1', 'TP2']);
  });

  it('deselects an already-selected probe', () => {
    expect(toggleProbe(['TP1', 'TP2'], 'TP1')).toEqual(['TP2']);
  });

  it('drops the oldest probe when a third is placed', () => {
    expect(toggleProbe(['TP1', 'TP2'], 'TP3')).toEqual(['TP2', 'TP3']);
  });
});

describe('visibleResult', () => {
  const RESULT_TP1_TP2 = {
    fault_id: 'r1_open',
    probes: { TP1: 9, TP2: 0 },
    differential_volts: 9,
  };

  it('returns null when nothing has been measured yet', () => {
    expect(visibleResult(null, ['TP1', 'TP2'])).toBeNull();
  });

  it('returns null while fewer than two probes are selected', () => {
    expect(visibleResult(RESULT_TP1_TP2, ['TP1'])).toBeNull();
  });

  it('returns the result when it matches the current selection', () => {
    expect(visibleResult(RESULT_TP1_TP2, ['TP1', 'TP2'])).toBe(RESULT_TP1_TP2);
  });

  it('returns null for a stale result left over from the previous pair after a third probe is placed', () => {
    // Regression test: placing a third probe slides the selection window
    // (TP1,TP2 -> TP2,TP3) in the same render where the fetched `result` is
    // still the old TP1/TP2 measurement, one tick before the effect that
    // re-measures it clears it out. Rendering RESULT_TP1_TP2.probes.TP3
    // (undefined) used to throw on .toFixed() and blank the whole page.
    expect(visibleResult(RESULT_TP1_TP2, ['TP2', 'TP3'])).toBeNull();
  });
});
