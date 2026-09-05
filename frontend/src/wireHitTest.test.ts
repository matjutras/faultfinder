import { describe, expect, it } from 'vitest';
import { hitTestSegments, nearestPointOnSegment } from './wireHitTest';
import type { Segment } from './wireHitTest';

describe('nearestPointOnSegment', () => {
  const seg: Segment = { x1: 0, y1: 0, x2: 10, y2: 0, node: 'VIN' };

  it('projects perpendicularly onto the middle of the segment', () => {
    const hit = nearestPointOnSegment(5, 3, seg);
    expect(hit.x).toBeCloseTo(5);
    expect(hit.y).toBeCloseTo(0);
    expect(hit.distance).toBeCloseTo(3);
    expect(hit.node).toBe('VIN');
  });

  it('clamps to the near endpoint when the projection falls before it', () => {
    const hit = nearestPointOnSegment(-5, 4, seg);
    expect(hit.x).toBeCloseTo(0);
    expect(hit.y).toBeCloseTo(0);
    expect(hit.distance).toBeCloseTo(Math.hypot(5, 4));
  });

  it('clamps to the far endpoint when the projection falls past it', () => {
    const hit = nearestPointOnSegment(15, 4, seg);
    expect(hit.x).toBeCloseTo(10);
    expect(hit.y).toBeCloseTo(0);
    expect(hit.distance).toBeCloseTo(Math.hypot(5, 4));
  });

  it('handles a zero-length segment as a single point', () => {
    const point: Segment = { x1: 3, y1: 3, x2: 3, y2: 3, node: 'GND' };
    const hit = nearestPointOnSegment(3, 7, point);
    expect(hit.distance).toBeCloseTo(4);
  });
});

describe('hitTestSegments', () => {
  const segments: Segment[] = [
    { x1: 0, y1: 0, x2: 10, y2: 0, node: 'VIN' },
    { x1: 0, y1: 5, x2: 10, y2: 5, node: 'VOUT' },
  ];

  it('picks the closer of two segments within tolerance', () => {
    const hit = hitTestSegments(5, 4, segments, 2);
    expect(hit?.node).toBe('VOUT');
  });

  it('returns null when nothing is within tolerance', () => {
    expect(hitTestSegments(5, 2.5, segments, 1)).toBeNull();
  });
});
