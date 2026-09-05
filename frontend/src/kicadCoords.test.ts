import { describe, expect, it } from 'vitest';
import { pcbCameraFraming, pcbHitTargetWorldRadius, pcbMmToThreeVec3 } from './kicadCoords';

describe('pcbMmToThreeVec3', () => {
  it('maps board mm to meters with NO axis flip -- kicad-cli glb export already bakes this', () => {
    // Verified against a real `kicad-cli pcb export glb` output: a footprint
    // placed at PCB (10mm, 10mm) landed at glTF translation (0.01, ~top, 0.01),
    // and a board outline drawn at PCB (2,2)-(62,20)mm produced a glTF slab
    // spanning exactly x:[0.002,0.062] z:[0.002,0.02] -- so PCB x -> glTF x and
    // PCB y -> glTF z directly, with no sign flip and no extra offset.
    const [x, , z] = pcbMmToThreeVec3(10, 20, 1.51);
    expect(x).toBeCloseTo(0.01, 6);
    expect(z).toBeCloseTo(0.02, 6);
  });

  it('places the marker just above the board top surface (thickness axis)', () => {
    const [, y] = pcbMmToThreeVec3(0, 0, 1.51);
    expect(y).toBeGreaterThan(0.00151); // above the copper/silkscreen top
    expect(y).toBeCloseTo(0.00251, 6); // thickness + fixed hit-target offset
  });

  it('scales with a different board thickness', () => {
    const [, y1] = pcbMmToThreeVec3(0, 0, 1.6);
    const [, y2] = pcbMmToThreeVec3(0, 0, 0.8);
    expect(y1).toBeGreaterThan(y2);
  });
});

describe('pcbCameraFraming', () => {
  it('targets the board center, not the glTF origin (which is a corner)', () => {
    const { target } = pcbCameraFraming({ width: 36, height: 24 }, 1.51);
    expect(target[0]).toBeCloseTo(0.018, 6); // width/2 in meters
    expect(target[2]).toBeCloseTo(0.012, 6); // depth/2 in meters
  });

  it('sets a near plane well inside the camera-to-board distance for small (cm-scale) boards', () => {
    // This is the actual bug: a default PerspectiveCamera near of 0.1 (10cm)
    // clips away a cm-scale board entirely, with no error -- it just never
    // reaches the screen. near must scale down with the board, not be fixed.
    const { position, target, near } = pcbCameraFraming({ width: 36, height: 24 }, 1.51);
    const dx = position[0] - target[0];
    const dy = position[1] - target[1];
    const dz = position[2] - target[2];
    const cameraDistance = Math.hypot(dx, dy, dz);
    expect(near).toBeLessThan(cameraDistance / 2);
  });

  it('places the camera far enough away to frame the whole board, and scales with board size', () => {
    const small = pcbCameraFraming({ width: 36, height: 24 }, 1.51);
    const big = pcbCameraFraming({ width: 360, height: 240 }, 1.51);

    const distOf = (f: ReturnType<typeof pcbCameraFraming>) =>
      Math.hypot(...f.position.map((v, i) => v - f.target[i]) as [number, number, number]);

    expect(distOf(small)).toBeGreaterThan(0.036); // board diagonal-ish, so it's not inside the board
    expect(distOf(big)).toBeGreaterThan(distOf(small));
    expect(big.far).toBeGreaterThan(small.far);
  });
});

describe('pcbHitTargetWorldRadius', () => {
  // Regression coverage for the mobile tap-target fix: the invisible probe
  // hit-target sphere used to be a fixed 0.0006m radius (the same as the
  // *visible* dot), which projects to only a couple of screen px -- nowhere
  // near a usable mobile touch target, and worse the closer OrbitControls
  // zoomed in. This computes the world radius needed for a ~44px on-screen
  // target at the *current* camera distance, every frame.

  function projectedScreenPx(worldRadius: number, distanceM: number, fovDeg: number, canvasHeightPx: number): number {
    const fovRad = (fovDeg * Math.PI) / 180;
    return (2 * worldRadius * canvasHeightPx) / (2 * Math.tan(fovRad / 2) * distanceM);
  }

  it('produces a world radius that projects back to exactly the requested screen pixel size', () => {
    const radius = pcbHitTargetWorldRadius(0.1, 40, 400, 44);
    expect(projectedScreenPx(radius, 0.1, 40, 400)).toBeCloseTo(44, 6);
  });

  it('scales linearly with camera distance, so the on-screen size stays constant as the user zooms', () => {
    // This is exactly the bug a fixed radius would reintroduce: without this
    // scaling, zooming out would shrink the effective tap target to nothing.
    const near = pcbHitTargetWorldRadius(0.1, 40, 400, 44);
    const far = pcbHitTargetWorldRadius(0.3, 40, 400, 44);
    expect(far).toBeCloseTo(near * 3, 6);
  });
});
