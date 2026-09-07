# Source

Schematic and PCB layout (`soft_power_switch_10.kicad_sch` / `.kicad_pcb` /
`.kicad_pro`) are imported from:

https://github.com/sbarabe/SBK_SP1

commit ce9fdb81a2a58da506570b151a327a37546803e2 ("SBK_SP1 V2..0 updates",
2026-08-16 -- the last commit that touched `hardware/KiCad/` as of
2026-09-07; HEAD of `main` at import time only touched `README.md`).

The schematic's own header declares KiCad 9 (`generator_version "9.0"`), but
the PCB's declares KiCad 10 (`generator_version "10.0"`) -- the two files
were evidently last saved from different KiCad versions by the source
repo's author. Both are within what this repo's KiCad 10.0.6 install (see
`reverse_polarity_08/NOTICE.md`) can parse, so this needed no further
toolchain changes.

# License

CERN Open Hardware Licence Version 2 - Permissive (CERN-OHL-P-2.0). Full
text in `LICENSE` in this directory (copied verbatim from the source repo).
Per the license's own terms, the licence text/notice must be kept with the
design, and anyone receiving a product built from it (or a copy of the
source) must be able to access this same source and notice -- satisfied
here by this file plus the verbatim `LICENSE` copy and the unmodified
`.kicad_sch`/`.kicad_pcb` source sitting alongside it.

# What's real vs. added for FaultFinder

The `.kicad_sch` is imported unmodified except for filename. The
`.kicad_pcb` is the same real, professionally-routed board (footprints,
placement, and every routed copper segment are untouched) -- not re-laid-out
by `backend/scripts/build_pcb.py` -- but its whole coordinate origin was
translated (via `backend/scripts/import_real_pcb.py`, a pure `board.Move()`)
so the board's own Edge_Cuts bounding box starts at (0,0). Pure translation
-- relative placement/routing is identical to the source file, just
re-anchored.

`circuit.cir` is FaultFinder's own addition (as for every device). The real
board is a soft-latch power switch (a P-channel MOSFET, Q2/AO3401A, as the
high-side switch; an N-channel MOSFET, Q1/AO3400A, as the MCU-controlled
"hold" transistor; two 1N4148 diodes, D3/D4, diode-ORing the onboard button
and the external SW/SENS interface pins into the same latch node) -- see
the source repo's own README for the full theory of operation. Three
modeling decisions this device needed that no prior device did:

- **HOLD (schematic pin J1.4) and SENS (J1.6) are external MCU interface
  pins** the real board expects an external microcontroller (or, per the
  source README, an external pull-up on SENS) to drive -- there's no MCU in
  this simulation, so both are left as dangling single-component stubs (the
  far terminal of R1 and D4 respectively, connected to nothing else). This
  is a genuinely different case from every prior device's "off-board
  connection" (always a single power source modeled as an equivalent V1) --
  here it's leaving a *logic* input undriven, which is the real board's own
  documented power-up-safe default (SW not pressed, no MCU yet driving
  HOLD -> output off, <1uA leakage per the README's own spec) rather than a
  simplification of something off-board.
- **SW1 (the onboard button) is modeled explicitly as a 1T (1e12-ohm)
  resistor to GND**, not simply omitted, to represent its natural resting
  (unpressed) state. Omitting it entirely was tried first and produced a
  real, confirmed ngspice singular-matrix failure on one of the generated
  add_short faults (a node defined by only two diodes at near-zero current
  has no well-conditioned DC path once a fault also removes its only other
  connection) -- fixed by giving that node an explicit, if enormous,
  resistive path to ground, the same technique `netlist.py`'s own
  `open_pin` patch already uses for exactly this reason.
- **`.options gmin=1e-9`** is set in `circuit.cir` itself (a standard SPICE
  convergence aid, not app code). This board's SW/D3/D4/M2-gate cluster is a
  deliberate positive-feedback latch -- that's the entire point of a soft
  power switch -- and ngspice's default solver genuinely failed to converge
  ("singular matrix", not assumed) on two different `add_short` faults that
  landed inside that regenerative loop, the same convergence sensitivity any
  regenerative circuit is known for. Every one of the 74 generated faults
  was actually run through ngspice (not just fault-pool-generated) before
  this device was accepted, per this repo's own dev-workflow rule, and all
  74 now simulate cleanly with this option set.

Q1's SPICE name is `M1` and Q2's is `M2` (not the schematic's own refs
"Q1"/"Q2") -- SPICE's `M` prefix is the universal MOSFET syntax, the same
reason every device's own source is always named `V1` regardless of the
schematic's power-symbol name. `map.json`'s probe geometry still uses the
real schematic refs "Q1"/"Q2" for pin placement, since that comes from
`kicad_import.py` parsing the `.kicad_sch` directly, independent of
`circuit.cir`'s own component naming.

D1/D2 (the input/output status LEDs) use the generic default diode model
convention every other device's LEDs already use; D3/D4 (real 1N4148
switching diodes) use a separate generic default diode model, since they're
a genuinely different real part, not LEDs. Q1/Q2 use the generic default
NMOS/PMOS models, the same bar this project already applies to a plain
discrete MOSFET (see `reverse_polarity_08/NOTICE.md`).

The board has no ground pour/zone -- GND is a single net routed the same as
every other net, so unlike some prior devices there's nothing here that
isn't already fully captured by discrete pad/track hit-testing.
