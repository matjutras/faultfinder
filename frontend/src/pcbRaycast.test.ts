import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { screenToBoardMm } from './pcbRaycast';

// A camera looking straight down (-Y) from directly above the board's origin
// corner, at a known height -- lets the expected intersection point be worked
// out by hand instead of just re-deriving whatever the function itself
// computes, so this is a real check against known geometry, not a tautology.
function topDownCamera(heightM: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(90, 1, 0.01, 100);
  camera.position.set(0, heightM, 0);
  camera.up.set(0, 0, -1); // so "up" on screen is -Z in world space, not undefined at this orientation
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

describe('screenToBoardMm', () => {
  const RECT = { left: 100, top: 200, width: 400, height: 400 };
  const BOARD_THICKNESS_MM = 1.51;

  it('maps the screen center straight down to the point below the camera', () => {
    const camera = topDownCamera(0.5);
    const result = screenToBoardMm(camera, 300, 400, RECT, BOARD_THICKNESS_MM); // center of RECT
    expect(result).not.toBeNull();
    expect(result!.xMm).toBeCloseTo(0, 3);
    expect(result!.yMm).toBeCloseTo(0, 3);
  });

  it('maps an off-center screen point to a proportionally offset board point', () => {
    const camera = topDownCamera(1); // fov=90 at height 1m -> visible half-extent is 1m each side
    // A quarter of the way from center to the right edge of a 90deg-fov,
    // height-1 camera lands at x = tan(45deg)*1 * 0.5 = 0.5m = 500mm.
    const rightOfCenterX = RECT.left + RECT.width * 0.75;
    const result = screenToBoardMm(camera, rightOfCenterX, RECT.top + RECT.height / 2, RECT, BOARD_THICKNESS_MM);
    expect(result).not.toBeNull();
    // Within ~5mm of the hand-derived 500mm: the plane sits a hair below
    // y=0 (board thickness + hit-target clearance), which the exact
    // intersection accounts for and this hand check doesn't bother to.
    expect(result!.xMm).toBeCloseTo(500, -1);
    expect(result!.yMm).toBeCloseTo(0, -1);
  });

  it('returns null for a drop point outside the given screen rect', () => {
    const camera = topDownCamera(0.5);
    expect(screenToBoardMm(camera, 50, 400, RECT, BOARD_THICKNESS_MM)).toBeNull(); // left of RECT.left
    expect(screenToBoardMm(camera, 300, 50, RECT, BOARD_THICKNESS_MM)).toBeNull(); // above RECT.top
  });
});
