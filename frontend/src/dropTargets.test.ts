import { describe, expect, it } from 'vitest';
import { resolvePcbDropTarget, resolveSchematicDropTarget } from './dropTargets';

describe('resolveSchematicDropTarget', () => {
  const device = {
    pins: [
      { ref: 'TP1', pin: '1', node: 'VIN', x_mm: 50, y_mm: 50 },
      { ref: 'TP2', pin: '1', node: 'VOUT', x_mm: 20, y_mm: 20 },
    ],
    wires: [{ node: 'VOUT', x1_mm: 20, y1_mm: 20, x2_mm: 80, y2_mm: 20 }],
  };
  // 800x880 container against the device's own 100x110mm page -> 8px/mm,
  // matching SchematicProbeView's real render scale.
  const W = 800;
  const H = 880;

  it('snaps to the nearest pin within its drop radius', () => {
    const target = resolveSchematicDropTarget(400, 400, device, W, H); // TP1 at (50,50)mm -> (400,400)px
    expect(target).toEqual({ targetId: 'TP1:1', node: 'VIN', x: 400, y: 400 });
  });

  it('prefers a pin over a wire when both are within tolerance', () => {
    // TP2 (20,20)mm -> (160,160)px sits exactly on the wire's own start point too.
    const target = resolveSchematicDropTarget(160, 160, device, W, H);
    expect(target?.targetId).toBe('TP2:1');
  });

  it('snaps to the nearest point on a wire when no pin is close enough', () => {
    // Wire runs y=160px, x from 160 to 640px; drop a bit off the line at midpoint.
    const target = resolveSchematicDropTarget(400, 163, device, W, H);
    expect(target?.node).toBe('VOUT');
    expect(target?.y).toBeCloseTo(160, 0);
  });

  it('returns null when the drop lands nowhere near a pin or wire', () => {
    expect(resolveSchematicDropTarget(700, 700, device, W, H)).toBeNull();
  });
});

describe('resolvePcbDropTarget', () => {
  const device = {
    pcb_pads: [
      { ref: 'TP1', pin: '1', node: 'VIN', x_mm: 30, y_mm: 6 },
      { ref: 'J1', pin: '2', node: '0', x_mm: 30, y_mm: 32.54 },
    ],
    pcb_tracks: [{ node: 'VIN', layer: 'F.Cu', x1_mm: 5, y1_mm: 6, x2_mm: 30, y2_mm: 6 }],
  };

  it('snaps to the nearest pad within its drop tolerance', () => {
    expect(resolvePcbDropTarget(30.5, 6.5, device)).toEqual({ targetId: 'TP1:1', node: 'VIN', x: 30, y: 6 });
  });

  it('falls back to the nearest track point when no pad is close enough', () => {
    const target = resolvePcbDropTarget(15, 6.4, device);
    expect(target?.node).toBe('VIN');
    expect(target?.y).toBeCloseTo(6, 5);
  });

  it('returns null when the drop lands on empty board with nothing nearby', () => {
    expect(resolvePcbDropTarget(60, 60, device)).toBeNull();
  });
});
