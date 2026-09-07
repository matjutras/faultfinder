import { isContinuous } from './continuity';
import type { DmmMode, MeasureResult, MultimeterMode } from './types';

function formatOhms(ohms: number): string {
  if (ohms >= 1e6) return `${(ohms / 1e6).toFixed(2)} MΩ`;
  if (ohms >= 1e3) return `${(ohms / 1e3).toFixed(2)} kΩ`;
  return `${ohms.toFixed(1)} Ω`;
}

// Continuity mode has no backend mode of its own -- it's an 'ohms'
// measurement (see continuity.ts) with a different dial position. Callers
// must send the API this, not the raw MultimeterMode, on every /measure call.
export function apiDmmMode(mode: MultimeterMode): DmmMode {
  return mode === 'continuity' ? 'ohms' : mode;
}

// The multimeter's digital-display text for the current mode/reading --
// shared by both views so the schematic and PCB multimeters format
// identically. `null` in ohms/diode/continuity mode is a real open circuit
// ("0L" on a real meter), not a missing value.
export function formatDmmReading(mode: MultimeterMode, result: MeasureResult | null): string {
  if (!result) return '— —';
  switch (mode) {
    case 'voltage':
      return `${(result.differential_volts ?? 0).toFixed(3)} V`;
    case 'ohms':
      return result.resistance_ohms == null ? '0L' : formatOhms(result.resistance_ohms);
    case 'diode':
      return result.diode_forward_volts == null ? '0L' : `${result.diode_forward_volts.toFixed(3)} V`;
    case 'continuity':
      if (result.resistance_ohms == null) return '0L';
      return isContinuous(result.resistance_ohms) ? `•))) ${formatOhms(result.resistance_ohms)}` : formatOhms(result.resistance_ohms);
    default:
      return '';
  }
}
