import { describe, expect, it } from 'vitest';
import { toggleProbe } from './probeSelection';

describe('toggleProbe', () => {
  it('adds a probe to an empty selection', () => {
    expect(toggleProbe([], 'TP1')).toEqual(['TP1']);
  });

  it('adds a second, distinct probe', () => {
    expect(toggleProbe(['TP1'], 'TP2')).toEqual(['TP1', 'TP2']);
  });

  it('deselects an already-selected probe', () => {
    expect(toggleProbe(['TP1', 'TP2'], 'TP1')).toEqual(['TP2']);
  });

  it('drops the oldest probe when a third is placed', () => {
    expect(toggleProbe(['TP1', 'TP2'], 'TP3')).toEqual(['TP2', 'TP3']);
  });
});
