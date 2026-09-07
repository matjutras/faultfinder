import { describe, expect, it } from 'vitest';
import { apiDmmMode, formatDmmReading } from './dmmDisplay';
import type { MeasureResult } from './types';

describe('formatDmmReading', () => {
  it('shows a placeholder when nothing has been measured yet', () => {
    expect(formatDmmReading('voltage', null)).toBe('— —');
  });

  it('formats a voltage reading to 3 decimals', () => {
    const result: MeasureResult = { fault_id: 'healthy', mode: 'voltage', differential_volts: 3.14159 };
    expect(formatDmmReading('voltage', result)).toBe('3.142 V');
  });

  it('auto-ranges a small ohms reading in plain ohms', () => {
    const result: MeasureResult = { fault_id: 'healthy', mode: 'ohms', resistance_ohms: 666.667 };
    expect(formatDmmReading('ohms', result)).toBe('666.7 Ω');
  });

  it('auto-ranges a large ohms reading into kilohms', () => {
    const result: MeasureResult = { fault_id: 'healthy', mode: 'ohms', resistance_ohms: 2000 };
    expect(formatDmmReading('ohms', result)).toBe('2.00 kΩ');
  });

  it('auto-ranges an even larger ohms reading into megohms', () => {
    const result: MeasureResult = { fault_id: 'healthy', mode: 'ohms', resistance_ohms: 4_500_000 };
    expect(formatDmmReading('ohms', result)).toBe('4.50 MΩ');
  });

  it('shows 0L for an open ohms reading', () => {
    const result: MeasureResult = { fault_id: 'healthy', mode: 'ohms', resistance_ohms: null };
    expect(formatDmmReading('ohms', result)).toBe('0L');
  });

  it('formats a diode forward-voltage reading', () => {
    const result: MeasureResult = { fault_id: 'healthy', mode: 'diode', diode_forward_volts: 0.4696388 };
    expect(formatDmmReading('diode', result)).toBe('0.470 V');
  });

  it('shows 0L for an open diode reading', () => {
    const result: MeasureResult = { fault_id: 'healthy', mode: 'diode', diode_forward_volts: null };
    expect(formatDmmReading('diode', result)).toBe('0L');
  });

  it('shows a beep indicator plus the reading for a continuous (low-resistance) continuity result', () => {
    const result: MeasureResult = { fault_id: 'healthy', mode: 'ohms', resistance_ohms: 0.8 };
    expect(formatDmmReading('continuity', result)).toBe('•))) 0.8 Ω');
  });

  it('shows the plain reading, no beep indicator, for a continuity result above the threshold', () => {
    const result: MeasureResult = { fault_id: 'healthy', mode: 'ohms', resistance_ohms: 4700 };
    expect(formatDmmReading('continuity', result)).toBe('4.70 kΩ');
  });

  it('shows 0L for an open continuity reading', () => {
    const result: MeasureResult = { fault_id: 'healthy', mode: 'ohms', resistance_ohms: null };
    expect(formatDmmReading('continuity', result)).toBe('0L');
  });
});

describe('apiDmmMode', () => {
  it('maps continuity to the real ohms wire mode', () => {
    expect(apiDmmMode('continuity')).toBe('ohms');
  });

  it('passes every real DmmMode through unchanged', () => {
    expect(apiDmmMode('voltage')).toBe('voltage');
    expect(apiDmmMode('ohms')).toBe('ohms');
    expect(apiDmmMode('diode')).toBe('diode');
  });
});
