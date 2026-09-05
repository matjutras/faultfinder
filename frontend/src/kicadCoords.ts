// KiCad's `(paper "A4")` with no `(portrait)` modifier renders landscape
// (297mm wide x 210mm tall) -- confirmed against a real KiCanvas render, not
// assumed. `controls="none"` fits the whole page into its container
// (letterboxed, centered), so this is a plain "object-fit: contain" transform.
const PAGE_WIDTH_MM = 297;
const PAGE_HEIGHT_MM = 210;

export function schematicMmToPixels(
  xMm: number,
  yMm: number,
  containerWidth: number,
  containerHeight: number,
): { x: number; y: number } {
  const scale = Math.min(containerWidth / PAGE_WIDTH_MM, containerHeight / PAGE_HEIGHT_MM);
  const offsetX = (containerWidth - PAGE_WIDTH_MM * scale) / 2;
  const offsetY = (containerHeight - PAGE_HEIGHT_MM * scale) / 2;
  return { x: offsetX + xMm * scale, y: offsetY + yMm * scale };
}

// kicad-cli's `pcb export glb` places the board directly in glTF/three.js
// space with NO axis flip: board/pad X (mm) -> glTF X (m), board/pad Y (mm)
// -> glTF Z (m), and glTF Y is the vertical (board-thickness) axis. Confirmed
// against a real export, not assumed -- see CLAUDE.md's PCB view gotcha about
// the Y-down/Y-up mismatch: that warning is about raw pcbnew pad coordinates
// (KiCad-internal, Y-down), not about this already-flipped glb output.
const MM_PER_M = 1000;
const HIT_TARGET_HEIGHT_M = 0.001; // sits just above the copper/silkscreen top

export function pcbMmToThreeVec3(
  xMm: number,
  yMm: number,
  boardThicknessMm: number,
): [number, number, number] {
  return [
    xMm / MM_PER_M,
    boardThicknessMm / MM_PER_M + HIT_TARGET_HEIGHT_M,
    yMm / MM_PER_M,
  ];
}

export interface PcbCameraFraming {
  target: [number, number, number];
  position: [number, number, number];
  near: number;
  far: number;
}

// glTF units are meters, so an auto-placed board (a few cm) sits at scene
// scale ~0.01-0.05 -- far below the default PerspectiveCamera near plane
// (0.1). A camera close enough to frame something that small then has the
// entire board fall inside the near-clip zone: nothing gets culled with an
// error, it just silently never reaches the screen. This computes near/far
// and a camera position/target from the device's own board_size_mm instead
// of a fixed guess, so it keeps working as board sizes vary between devices.
export function pcbCameraFraming(
  boardSizeMm: { width: number; height: number },
  boardThicknessMm: number,
): PcbCameraFraming {
  const widthM = boardSizeMm.width / MM_PER_M;
  const depthM = boardSizeMm.height / MM_PER_M; // PCB "height" (Y) -> glTF Z
  const thicknessM = boardThicknessMm / MM_PER_M;
  const diagonal = Math.hypot(widthM, depthM) || 0.01;

  const target: [number, number, number] = [widthM / 2, thicknessM / 2, depthM / 2];
  const position: [number, number, number] = [
    target[0],
    target[1] + diagonal * 0.9,
    target[2] + diagonal * 1.1,
  ];

  return { target, position, near: diagonal / 100, far: diagonal * 20 };
}

// The world-space radius an invisible probe hit-target sphere needs so it
// subtends `desiredScreenPx` pixels on screen at the given camera distance --
// a fixed world-space radius would only be the right size at one particular
// OrbitControls zoom level, which matters a lot on mobile where pinch-zoom
// is the norm. Standard perspective-projection inverse: world-units-per-pixel
// at a given distance is (2 * tan(halfFov) * distance) / canvasHeightPx.
export function pcbHitTargetWorldRadius(
  distanceM: number,
  verticalFovDeg: number,
  canvasHeightPx: number,
  desiredScreenPx: number,
): number {
  const verticalFovRad = (verticalFovDeg * Math.PI) / 180;
  const worldUnitsPerPixel = (2 * Math.tan(verticalFovRad / 2) * distanceM) / canvasHeightPx;
  return (desiredScreenPx / 2) * worldUnitsPerPixel;
}
