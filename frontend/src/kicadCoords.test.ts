import { describe, expect, it } from 'vitest';
import { pcbCameraFraming, pcbMmToThreeVec3 } from './kicadCoords';

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
