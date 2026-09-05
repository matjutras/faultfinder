// Resolves where a dragged multimeter lead landed, for both views -- same
// "exact parsed geometry, not proximity-guessing" principle as the old
// click-based probe placement (see wireHitTest.ts, kicadCoords.ts): a lead
// snaps to the nearest real pin/pad/wire/track point within a small
// tolerance of the drop location, never to an arbitrary click/drop pixel.
import type { ProbeTarget } from './probeSelection';
import { hitTestSegments, nearestPointOnSegment } from './wireHitTest';
import { schematicMmToPixels } from './kicadCoords';
import type { Device } from './types';

// Matches the schematic pin marker's old tappable radius (44px box / 2) and
// the wire hit-strip's old thickness (14px / 2) -- the drop tolerance stays
// the same size a finger/cursor target was before, just evaluated at drop
// time instead of via a rendered click target.
const PIN_DROP_RADIUS_PX = 22;
const WIRE_DROP_TOLERANCE_PX = 7;

export function resolveSchematicDropTarget(
  localX: number,
  localY: number,
  device: Pick<Device, 'pins' | 'wires'>,
  containerWidth: number,
  containerHeight: number,
): ProbeTarget | null {
  let best: { target: ProbeTarget; distance: number } | null = null;

  for (const p of device.pins) {
    const { x, y } = schematicMmToPixels(p.x_mm, p.y_mm, containerWidth, containerHeight);
    const distance = Math.hypot(localX - x, localY - y);
    if (distance <= PIN_DROP_RADIUS_PX && (!best || distance < best.distance)) {
      best = { target: { targetId: `${p.ref}:${p.pin}`, node: p.node, x, y }, distance };
    }
  }
  if (best) return best.target;

  for (let i = 0; i < device.wires.length; i++) {
    const w = device.wires[i];
    const p1 = schematicMmToPixels(w.x1_mm, w.y1_mm, containerWidth, containerHeight);
    const p2 = schematicMmToPixels(w.x2_mm, w.y2_mm, containerWidth, containerHeight);
    const hit = nearestPointOnSegment(localX, localY, { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, node: w.node });
    if (hit.distance <= WIRE_DROP_TOLERANCE_PX && (!best || hit.distance < best.distance)) {
      best = {
        target: { targetId: `wire:${i}:${hit.x.toFixed(1)}:${hit.y.toFixed(1)}`, node: hit.node, x: hit.x, y: hit.y },
        distance: hit.distance,
      };
    }
  }
  return best?.target ?? null;
}

// PCB pads are real physical footprints (~1-2mm across), so a millimeter-scale
// tolerance -- not a screen-pixel one -- is the natural unit here: it stays
// correct regardless of camera zoom, unlike a fixed screen-px radius would.
const PAD_DROP_TOLERANCE_MM = 2;
const TRACK_DROP_TOLERANCE_MM = 1;

export function resolvePcbDropTarget(
  xMm: number,
  yMm: number,
  device: Pick<Device, 'pcb_pads' | 'pcb_tracks'>,
): ProbeTarget | null {
  let best: { target: ProbeTarget; distance: number } | null = null;

  for (const pad of device.pcb_pads) {
    const distance = Math.hypot(xMm - pad.x_mm, yMm - pad.y_mm);
    if (distance <= PAD_DROP_TOLERANCE_MM && (!best || distance < best.distance)) {
      best = { target: { targetId: `${pad.ref}:${pad.pin}`, node: pad.node, x: pad.x_mm, y: pad.y_mm }, distance };
    }
  }
  if (best) return best.target;

  const segments = device.pcb_tracks.map((t) => ({ x1: t.x1_mm, y1: t.y1_mm, x2: t.x2_mm, y2: t.y2_mm, node: t.node }));
  const hit = hitTestSegments(xMm, yMm, segments, TRACK_DROP_TOLERANCE_MM);
  if (!hit) return null;
  return { targetId: `track:${hit.node}:${hit.x.toFixed(2)}:${hit.y.toFixed(2)}`, node: hit.node, x: hit.x, y: hit.y };
}
