// Continuity mode is deliberately just resistance mode (dmm.py's existing
// measure_resistance_ohms -- zero the sources, inject a test current, read
// the drop back) with a beep/indicator threshold layered on top in the
// frontend: cheap to add on top of the existing simulation logic, no new
// backend endpoint or SPICE technique needed. See dmmDisplay.ts's
// `apiDmmMode` for where 'continuity' gets mapped back to the real 'ohms'
// wire mode before the /measure call.
//
// 30-50ohm is the typical "beeps" threshold on a real handheld DMM (well
// above a solid wire/trace's near-zero resistance, well below even a small
// resistor); this project's smallest real resistor values are in the tens
// to hundreds of ohms (see any device's circuit.cir), so 50ohm cleanly
// separates "the same node" from "a real component between the probes".
export const CONTINUITY_THRESHOLD_OHMS = 50;

export function isContinuous(resistanceOhms: number | null | undefined): boolean {
  return resistanceOhms != null && resistanceOhms <= CONTINUITY_THRESHOLD_OHMS;
}
