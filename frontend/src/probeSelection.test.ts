import { describe, expect, it } from 'vitest';
import { EMPTY_LEADS, placeLead, selectedNodes, visibleResult } from './probeSelection';
import type { Leads, ProbeTarget } from './probeSelection';

const TP1: ProbeTarget = { targetId: 'TP1:1', node: 'VIN', x: 1, y: 1 };
const TP2: ProbeTarget = { targetId: 'TP2:1', node: 'VOUT', x: 2, y: 2 };
const TP3: ProbeTarget = { targetId: 'TP3:1', node: '0', x: 3, y: 3 };

describe('placeLead', () => {
  it('places the first click as red', () => {
    expect(placeLead(EMPTY_LEADS, TP1)).toEqual({ red: TP1, black: null });
  });

  it('places a second, distinct click as black', () => {
    const leads: Leads = { red: TP1, black: null };
    expect(placeLead(leads, TP2)).toEqual({ red: TP1, black: TP2 });
  });

  it('removes red when its own target is re-clicked', () => {
    const leads: Leads = { red: TP1, black: TP2 };
    expect(placeLead(leads, TP1)).toEqual({ red: null, black: TP2 });
  });

  it('removes black when its own target is re-clicked', () => {
    const leads: Leads = { red: TP1, black: TP2 };
    expect(placeLead(leads, TP2)).toEqual({ red: TP1, black: null });
  });

  it('slides the window when a third distinct target is placed: red is dropped, black becomes red', () => {
    const leads: Leads = { red: TP1, black: TP2 };
    expect(placeLead(leads, TP3)).toEqual({ red: TP2, black: TP3 });
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
  const RESULT_VIN_VOUT = {
    fault_id: 'r1_open',
    probes: [
      { node: 'VIN', volts: 9 },
      { node: 'VOUT', volts: 0 },
    ],
    differential_volts: 9,
  };

  it('returns null when nothing has been measured yet', () => {
    expect(visibleResult(null, { red: TP1, black: TP2 })).toBeNull();
  });

  it('returns null while fewer than two leads are placed', () => {
    expect(visibleResult(RESULT_VIN_VOUT, { red: TP1, black: null })).toBeNull();
  });

  it('returns the result when it matches the current leads', () => {
    expect(visibleResult(RESULT_VIN_VOUT, { red: TP1, black: TP2 })).toBe(RESULT_VIN_VOUT);
  });

  it('returns null for a stale result left over from the previous pair after a third probe is placed', () => {
    // Regression test: placing a third probe slides the lead window
    // (TP1,TP2 -> TP2,TP3) in the same render where the fetched `result` is
    // still the old TP1/TP2 measurement, one tick before the effect that
    // re-measures it clears it out. Rendering a stale result against a node
    // it doesn't have used to throw on .toFixed() and blank the whole page.
    const slid: Leads = { red: TP2, black: TP3 }; // TP3 resolves to node "0", not in RESULT_VIN_VOUT
    expect(visibleResult(RESULT_VIN_VOUT, slid)).toBeNull();
  });
});
