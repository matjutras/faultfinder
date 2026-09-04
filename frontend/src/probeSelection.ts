import type { MeasureResult } from './types';

export function toggleProbe(selected: string[], tpId: string): string[] {
  if (selected.includes(tpId)) {
    return selected.filter((id) => id !== tpId);
  }
  if (selected.length < 2) {
    return [...selected, tpId];
  }
  return [selected[1], tpId];
}

// A fetched `result` and the current `selected` pair can briefly disagree:
// placing a third probe slides the selection window (toggleProbe above) in
// the same render pass where `result` still holds the previous pair's
// measurement, one tick before the effect that re-measures it clears it out.
// Rendering that stale result against the new selection reads a probe id
// that isn't in it -- so callers must render through this instead of `result`
// directly.
export function visibleResult(result: MeasureResult | null, selected: string[]): MeasureResult | null {
  if (!result || selected.length !== 2) return null;
  return selected.every((id) => id in result.probes) ? result : null;
}
