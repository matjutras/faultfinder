import { describe, expect, it } from 'vitest';
import { EMPTY_LEADS, selectedNodes, setLead, visibleResult } from './probeSelection';
import type { Leads, Measurement, ProbeTarget } from './probeSelection';
import type { MeasureResult } from './types';

const TP1: ProbeTarget = { targetId: 'TP1:1', node: 'VIN', x: 1, y: 1 };
const TP2: ProbeTarget = { targetId: 'TP2:1', node: 'VOUT', x: 2, y: 2 };
const TP3: ProbeTarget = { targetId: 'TP3:1', node: '0', x: 3, y: 3 };

describe('setLead', () => {
  it('places the red lead into empty leads', () => {
    expect(setLead(EMPTY_LEADS, 'red', TP1)).toEqual({ red: TP1, black: null });
  });

  it('places the black lead independently of red', () => {
    const leads: Leads = { red: TP1, black: null };
    expect(setLead(leads, 'black', TP2)).toEqual({ red: TP1, black: TP2 });
  });

  it('re-dragging red to a new target replaces only red, leaving black untouched', () => {
    const leads: Leads = { red: TP1, black: TP2 };
    expect(setLead(leads, 'red', TP3)).toEqual({ red: TP3, black: TP2 });
  });

  it('re-dragging black to a new target replaces only black, leaving red untouched', () => {
    const leads: Leads = { red: TP1, black: TP2 };
    expect(setLead(leads, 'black', TP3)).toEqual({ red: TP1, black: TP3 });
  });
});

describe('selectedNodes', () => {
  it('returns null until both leads are placed', () => {
    expect(selectedNodes(EMPTY_LEADS)).toBeNull();
    expect(selectedNodes({ red: TP1, black: null })).toBeNull();
  });

  it('returns both leads’ resolved nodes once placed', () => {
    expect(selectedNodes({ red: TP1, black: TP2 })).toEqual(['VIN', 'VOUT']);
  });
});

describe('visibleResult', () => {
  const RESULT: MeasureResult = {
    fault_id: 'r1_open',
    mode: 'voltage',
    probes: [
      { node: 'VIN', volts: 9 },
      { node: 'VOUT', volts: 0 },
    ],
    differential_volts: 9,
  };
  const MEASUREMENT: Measurement = { nodes: ['VIN', 'VOUT'], mode: 'voltage', result: RESULT };

  it('returns null when nothing has been measured yet', () => {
    expect(visibleResult(null, { red: TP1, black: TP2 }, 'voltage')).toBeNull();
  });

  it('returns null while fewer than two leads are placed', () => {
    expect(visibleResult(MEASUREMENT, { red: TP1, black: null }, 'voltage')).toBeNull();
  });

  it('returns the result when it matches the current leads and mode', () => {
    expect(visibleResult(MEASUREMENT, { red: TP1, black: TP2 }, 'voltage')).toBe(RESULT);
  });

  it('returns null for a stale measurement left over from the previous pair after a lead is re-dragged', () => {
    // Regression test: re-dragging the black lead (TP2 -> TP3) updates
    // `leads` in the same render where the fetched `measurement` is still
    // the old TP1/TP2 reading, one tick before the effect that re-measures
    // it clears it out. Rendering a stale measurement against the new pair
    // used to throw on .toFixed() and blank the whole page.
    const redragged: Leads = { red: TP1, black: TP3 };
    expect(visibleResult(MEASUREMENT, redragged, 'voltage')).toBeNull();
  });

  it('returns null for a stale measurement left over from switching mode', () => {
    // Same staleness risk, different trigger: switching V -> Ω while the
    // leads stay put still fetches a fresh reading, and the old voltage
    // measurement must not render as if it were an ohms reading meanwhile.
    expect(visibleResult(MEASUREMENT, { red: TP1, black: TP2 }, 'ohms')).toBeNull();
  });
});
