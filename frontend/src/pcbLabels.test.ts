import { describe, expect, it } from 'vitest';
import { componentLabelPositions } from './pcbLabels';

describe('componentLabelPositions', () => {
  it('places a label at the centroid of a component\'s own pads', () => {
    const labels = componentLabelPositions([
      { ref: 'R1', pin: '1', node: 'VOUT', x_mm: 5, y_mm: 6 },
      { ref: 'R1', pin: '2', node: 'VIN', x_mm: 7, y_mm: 6 },
    ]);

    expect(labels).toEqual([{ ref: 'R1', xMm: 6, yMm: 6 }]);
  });

  it('groups pads by ref independently, including single-pad refs', () => {
    const labels = componentLabelPositions([
      { ref: 'R1', pin: '1', node: 'VOUT', x_mm: 5, y_mm: 6 },
      { ref: 'R1', pin: '2', node: 'VIN', x_mm: 7, y_mm: 6 },
      { ref: 'TP1', pin: '1', node: 'VIN', x_mm: 30, y_mm: 6 },
    ]);

    expect(labels).toEqual([
      { ref: 'R1', xMm: 6, yMm: 6 },
      { ref: 'TP1', xMm: 30, yMm: 6 },
    ]);
  });

  it('returns nothing for a board with no pads', () => {
    expect(componentLabelPositions([])).toEqual([]);
  });
});
