import type { PcbPad } from './types';

export interface ComponentLabel {
  ref: string;
  xMm: number;
  yMm: number;
}

// kicad-cli's glb exporter doesn't bake footprint reference/value text into
// the exported board mesh -- confirmed with a real close-up screenshot of an
// exported board (see CLAUDE.md's gotcha entry): every other silkscreen
// element renders, but no ref text, even though the KiCad source itself
// places a real, visible "Reference" property on the F.SilkS layer for
// every footprint (build_pcb.py never hides it). Rather than pull in a
// 3D text-rendering library with its own default network font fetch
// (troika-three-text, which every @react-three/drei <Text> depends on,
// would need a real self-hosted font file to match this project's
// vendored-not-CDN'd asset philosophy -- see kicanvas.js), each
// component's own real pad positions -- already sent to the frontend, see
// types.ts's PcbPad -- are enough to place a plain label at its centroid.
export function componentLabelPositions(pads: PcbPad[]): ComponentLabel[] {
  const sums = new Map<string, { x: number; y: number; count: number }>();
  for (const pad of pads) {
    const entry = sums.get(pad.ref) ?? { x: 0, y: 0, count: 0 };
    entry.x += pad.x_mm;
    entry.y += pad.y_mm;
    entry.count += 1;
    sums.set(pad.ref, entry);
  }
  return [...sums.entries()].map(([ref, { x, y, count }]) => ({
    ref,
    xMm: x / count,
    yMm: y / count,
  }));
}
