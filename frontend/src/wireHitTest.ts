export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  node: string;
}

export interface SegmentHit {
  x: number;
  y: number;
  node: string;
  distance: number;
}

// Closest point *on* the segment (clamped to its endpoints, not the infinite
// line through it) to (px,py), plus the distance to it. Unit-agnostic --
// callers pass mm or px consistently on both sides.
export function nearestPointOnSegment(px: number, py: number, seg: Segment): SegmentHit {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - seg.x1) * dx + (py - seg.y1) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const x = seg.x1 + t * dx;
  const y = seg.y1 + t * dy;
  return { x, y, node: seg.node, distance: Math.hypot(px - x, py - y) };
}

// The closest segment to (px,py) across the whole list, or null if nothing
// falls within `tolerance` -- used where there's no other way to know which
// segment (if any) a click landed on, e.g. a 3D raycast hit point tested
// against the flat list of copper track segments from the PCB manifest.
export function hitTestSegments(
  px: number,
  py: number,
  segments: Segment[],
  tolerance: number,
): SegmentHit | null {
  let best: SegmentHit | null = null;
  for (const seg of segments) {
    const hit = nearestPointOnSegment(px, py, seg);
    if (hit.distance <= tolerance && (!best || hit.distance < best.distance)) {
      best = hit;
    }
  }
  return best;
}
