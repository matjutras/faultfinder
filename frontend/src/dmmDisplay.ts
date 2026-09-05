import type { DmmMode, MeasureResult } from './types';

function formatOhms(ohms: number): string {
  if (ohms >= 1e6) return `${(ohms / 1e6).toFixed(2)} MΩ`;
  if (ohms >= 1e3) return `${(ohms / 1e3).toFixed(2)} kΩ`;
  return `${ohms.toFixed(1)} Ω`;
}

// The multimeter's digital-display text for the current mode/reading --
// shared by both views so the schematic and PCB multimeters format
// identically. `null` in ohms/diode mode is a real open circuit ("0L" on a
// real meter), not a missing value.
export function formatDmmReading(mode: DmmMode, result: MeasureResult | null): string {
  if (!result) return '— —';
  switch (mode) {
    case 'voltage':
      return `${(result.differential_volts ?? 0).toFixed(3)} V`;
    case 'ohms':
      return result.resistance_ohms == null ? '0L' : formatOhms(result.resistance_ohms);
    case 'diode':
      return result.diode_forward_volts == null ? '0L' : `${result.diode_forward_volts.toFixed(3)} V`;
    default:
      return '';
  }
}
