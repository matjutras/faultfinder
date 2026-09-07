import type { DmmMode, MeasureResult } from './types';

// Where a tapped lead landed -- a pin, a pad, or a point along a wire/track
// (see dropTargets.ts). `targetId` identifies what it resolved to; `node` is
// the real SPICE node it resolves to, used for the actual /measure call;
// `x`/`y` are the landing position, for rendering the lead marker at the
// exact spot the probe landed.
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

export type LeadColor = 'red' | 'black';

// Click-to-arm/tap-to-place semantics: each lead is independently armed and
// placed from the multimeter graphic (see Multimeter.tsx/useTapGesture.ts),
// so placing one simply (re)assigns that lead's own target -- there's no
// shared "window" to slide, unlike the old click-to-cycle picker this
// replaced.
export function setLead(leads: Leads, color: LeadColor, target: ProbeTarget): Leads {
  return color === 'red' ? { ...leads, red: target } : { ...leads, black: target };
}

export function selectedNodes(leads: Leads): [string, string] | null {
  if (!leads.red || !leads.black) return null;
  return [leads.red.node, leads.black.node];
}

// A fetched result tagged with exactly what it was fetched for -- since
// ohms/diode results (unlike voltage's `probes`) carry nothing that
// self-identifies which nodes produced them, the nodes/mode have to be
// tracked alongside the result instead of inferred from its contents.
export interface Measurement {
  nodes: [string, string];
  mode: DmmMode;
  result: MeasureResult;
}

// A fetched `measurement` and the current `leads`/`mode` can briefly
// disagree: re-dragging one lead to a new target (or switching mode) updates
// state in the same render pass where `measurement` still holds the previous
// pair's reading, one tick before the effect that re-measures it clears it
// out. Rendering that stale measurement would show a reading for the wrong
// probes/mode -- so callers must render through this instead of the fetched
// result directly.
export function visibleResult(measurement: Measurement | null, leads: Leads, mode: DmmMode): MeasureResult | null {
  const nodes = selectedNodes(leads);
  if (!measurement || !nodes) return null;
  if (measurement.mode !== mode) return null;
  return measurement.nodes[0] === nodes[0] && measurement.nodes[1] === nodes[1] ? measurement.result : null;
}
