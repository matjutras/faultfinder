// Every hand-authored device's .kicad_sch declares a custom `(paper "User"
// 100 110)` sheet (100mm x 110mm) instead of a standard size -- a full A4
// page around a 3-5 component teaching circuit left the actual symbols tiny
// relative to the fixed-size TP marker overlay; a page sized to the content
// makes the same symbols occupy far more of the rendered viewport. Confirmed
// against a real KiCanvas render, not assumed. `controls="none"` fits the
// whole page into its container (letterboxed, centered), so this is a plain
// "object-fit: contain" transform -- must match the device's own paper size
// exactly, which is NOT universally 100x110: a real-world imported device
// (e.g. bridge_rectifier_06) declares a plain standard sheet like "A4"
// instead, so callers pass the device's own page size (from the API,
// ultimately backend/app/kicad_import.py's parse_page_size_mm) rather than
// relying on these defaults, which exist only for the hand-authored devices'
// convention and as a fallback for a pre-page-size-field cached map.json.
const DEFAULT_PAGE_WIDTH_MM = 100;
const DEFAULT_PAGE_HEIGHT_MM = 110;

export function schematicMmToPixels(
  xMm: number,
  yMm: number,
  containerWidth: number,
  containerHeight: number,
  pageWidthMm: number = DEFAULT_PAGE_WIDTH_MM,
  pageHeightMm: number = DEFAULT_PAGE_HEIGHT_MM,
): { x: number; y: number } {
  const scale = Math.min(containerWidth / pageWidthMm, containerHeight / pageHeightMm);
  const offsetX = (containerWidth - pageWidthMm * scale) / 2;
  const offsetY = (containerHeight - pageHeightMm * scale) / 2;
  return { x: offsetX + xMm * scale, y: offsetY + yMm * scale };
}

// kicad-cli's `pcb export glb` places the board directly in glTF/three.js
// space with NO axis flip: board/pad X (mm) -> glTF X (m), board/pad Y (mm)
// -> glTF Z (m), and glTF Y is the vertical (board-thickness) axis. Confirmed
// against a real export, not assumed -- see CLAUDE.md's PCB view gotcha about
// the Y-down/Y-up mismatch: that warning is about raw pcbnew pad coordinates
// (KiCad-internal, Y-down), not about this already-flipped glb output.
export const MM_PER_M = 1000;
export const HIT_TARGET_HEIGHT_M = 0.001; // sits just above the copper/silkscreen top

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
