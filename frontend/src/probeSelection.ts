import type { MeasureResult } from './types';

// A clickable target the user probed -- a pin, a pad, or a point along a
// wire/track. `targetId` is stable for discrete pins/pads (so re-clicking the
// same one removes it), but effectively unique per click for a continuous
// wire/track point (there's no natural stable id for "the same spot on a
// wire" across renders) -- so toggle-off by re-click only works for discrete
// pins/pads, not wire points. `node` is the real SPICE node it resolves to,
// used for the actual /measure call; `x`/`y` are just the click position, for
// rendering the lead marker at the exact spot the user probed.
export interface ProbeTarget {
  targetId: string;
  node: string;
  x: number;
  y: number;
}

export interface Leads {
  red: ProbeTarget | null;
  black: ProbeTarget | null;
}

export const EMPTY_LEADS: Leads = { red: null, black: null };

// Click semantics: place into whichever lead is empty first (red, then
// black); re-clicking a lead's own target removes it; a third click once
// both are placed slides the window -- red is dropped, black becomes the new
// red, and the new click becomes black -- same sliding-window behavior as
// the original two-test-point picker.
export function placeLead(leads: Leads, target: ProbeTarget): Leads {
  if (leads.red && leads.red.targetId === target.targetId) {
    return { red: null, black: leads.black };
  }
  if (leads.black && leads.black.targetId === target.targetId) {
    return { red: leads.red, black: null };
  }
  if (!leads.red) return { red: target, black: leads.black };
  if (!leads.black) return { red: leads.red, black: target };
  return { red: leads.black, black: target };
}

export function selectedNodes(leads: Leads): [string, string] | null {
  if (!leads.red || !leads.black) return null;
  return [leads.red.node, leads.black.node];
}

// A fetched `result` and the current `leads` can briefly disagree: placing a
// third probe slides the lead window in the same render pass where `result`
// still holds the previous pair's measurement, one tick before the effect
// that re-measures it clears it out. Rendering that stale result against the
// new leads would read a node that isn't in it -- so callers must render
// through this instead of `result` directly.
export function visibleResult(result: MeasureResult | null, leads: Leads): MeasureResult | null {
  const nodes = selectedNodes(leads);
  if (!result || !nodes) return null;
  const resultNodes = new Set(result.probes.map((p) => p.node));
  return nodes.every((n) => resultNodes.has(n)) ? result : null;
}
