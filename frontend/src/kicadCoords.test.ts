import { describe, expect, it } from 'vitest';
import { pcbCameraFraming, pcbMmToThreeVec3, schematicMmToPixels } from './kicadCoords';

describe('schematicMmToPixels', () => {
  // Regression test: with the schematic container at its old 500x354px (a
  // ~3.2px/mm scale against the 100x110mm page), two TP markers needed
  // >13.6mm of real-world separation just for their 44px CSS tap targets not
  // to visually overlap -- every device's actual spacing (driven by real
  // component/pin geometry, 7.6-12.7mm) fell short somewhere. Confirmed by
  // measuring real rendered marker bounding boxes for pairwise overlap
  // across all 5 devices, not by eyeballing one screenshot. Fixed by
  // enlarging the container to 800x880 (~8px/mm) instead of re-cramming
  // every schematic's layout a second time -- this locks in that the
  // render scale itself gives enough headroom for a realistic tight gap.
  it('gives at least a 44px tap-target\'s worth of separation for a realistic tight TP gap', () => {
    const CONTAINER_WIDTH = 800;
    const CONTAINER_HEIGHT = 880;
    const TIGHT_GAP_MM = 7.62; // the actual tightest gap seen in a real device (transistor_switch_04)

    const a = schematicMmToPixels(50, 40, CONTAINER_WIDTH, CONTAINER_HEIGHT);
    const b = schematicMmToPixels(50, 40 + TIGHT_GAP_MM, CONTAINER_WIDTH, CONTAINER_HEIGHT);

    expect(Math.abs(b.y - a.y)).toBeGreaterThanOrEqual(44);
  });

  // Regression test: bridge_rectifier_06 (a real-world imported device)
  // declares a plain "A4" page instead of the hand-authored devices' own
  // 100x110 custom page, and its real pins go up to x=129.5mm -- past the
  // old hardcoded default width entirely. Passing the device's own page
  // size must scale the overlay to match, not silently clip/misplace it.
  it('scales against an explicit page size instead of the 100x110 default', () => {
    const CONTAINER_WIDTH = 800;
    const CONTAINER_HEIGHT = 880;
    const A4_LANDSCAPE_WIDTH_MM = 297;
    const A4_LANDSCAPE_HEIGHT_MM = 210;

    const { x, y } = schematicMmToPixels(
      129.5,
      49.53,
      CONTAINER_WIDTH,
      CONTAINER_HEIGHT,
      A4_LANDSCAPE_WIDTH_MM,
      A4_LANDSCAPE_HEIGHT_MM,
    );

    // scale is min(800/297, 880/210) = min(2.6936, 4.190) = 2.6936, letterboxed vertically
    const expectedScale = CONTAINER_WIDTH / A4_LANDSCAPE_WIDTH_MM;
    const expectedOffsetY = (CONTAINER_HEIGHT - A4_LANDSCAPE_HEIGHT_MM * expectedScale) / 2;
    expect(x).toBeCloseTo(129.5 * expectedScale, 5);
    expect(y).toBeCloseTo(expectedOffsetY + 49.53 * expectedScale, 5);
  });
});

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
