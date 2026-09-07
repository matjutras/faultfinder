# Source

Schematic and PCB layout (`battery_protection_09.kicad_sch` / `.kicad_pcb` /
`.kicad_pro`) are imported from:

https://github.com/imguxuuuu/Battery-Protection-PCB

commit 46946d797add63901a7fe3d423655a9ce5109090 (HEAD of `main` as of
2026-07-30, the only commit that has touched the KiCad source).

Like `reverse_polarity_08`, the source files are in KiCad 10's file format
(newer than the KiCad 9 install this repo had before this import) -- see
`reverse_polarity_08/NOTICE.md` for the KiCad 9->10 upgrade this required
and the one confirmed toolchain-output change (a same-layer track-crossing
regression test's raw-text regex, not a real routing regression) it caused.

# License

MIT License, Copyright (c) 2026 Gururaghuraman Sethuraman. Full text in
`LICENSE` in this directory (copied verbatim from the source repo). Per the
MIT License's own terms, that copyright notice and license text must be kept
with any copy or substantial portion of this schematic/PCB.

# What's real vs. added for FaultFinder

The `.kicad_sch` is imported unmodified except for filename. The
`.kicad_pcb` is the same real, professionally-routed board (footprints,
placement, and every routed copper segment are untouched) -- not re-laid-out
by `backend/scripts/build_pcb.py` -- but its whole coordinate origin was
translated (via `backend/scripts/import_real_pcb.py`, a pure `board.Move()`)
so the board's own Edge_Cuts bounding box starts at (0,0). Pure translation
-- relative placement/routing is identical to the source file, just
re-anchored.

The real board's own routing is single-sided (all 23 routed segments plus
2 copper-fill zones are on `F.Cu`; `B.Cu` carries no copper on this
particular board) -- unlike `reverse_polarity_08`, there was nothing to
re-route onto a second layer or bridge with a via, since a board this small
with this component count never produced a same-net-crossing conflict in
the first place. Still a real, professionally laid out board, just one
whose designer had no need of the back layer.

`circuit.cir` is FaultFinder's own addition (as for every device):

- BT1 (a real Li-Ion 3.7V cell, not a SPICE part) is modeled as an
  equivalent DC source (`V1`, 3.7V) at its own nominal voltage -- the same
  simplification every other device in this project makes at its own power
  input.
- F1 (a 500mA-rated PTC resettable fuse, also not a SPICE part) is modeled
  as a plain resistor at its datasheet's typical un-tripped series
  resistance (~1 ohm for a part in this current rating) -- a fuse's DC
  behavior *is* just a small series resistance below its trip point, so this
  isn't a stand-in the way the AC-source simplifications on other devices
  are, it's the part's actual normal-operation behavior.
- D1 (a 1N5819 Schottky diode) and the status LED both use ngspice's generic
  default diode model, the same convention every other device's
  diodes/LEDs already use.

Two SPICE naming collisions turned up between the real board's own ref
designators and SPICE's reserved element-type prefixes, found running this
circuit through ngspice for the first time:

- The real board's fuse is ref "F1" -- but SPICE reserves a bare "F" name
  for a current-controlled current source (a 4-argument dependent-source
  element), not a plain resistor. ngspice rejected `F1 bat_raw net__d1_a_ 1`
  outright ("not enough parameters"). Renamed to `R4` in `circuit.cir` only.
- The real board's status LED is ref "LED1" -- but a diode-family SPICE
  element must start with "D" (both for ngspice itself and for
  `fault_gen.py`'s ref-prefix fault-type table, which would otherwise treat
  an "L"-prefixed component as an inductor). Renamed to `D2` in
  `circuit.cir` only.

Neither rename touches `map.json`'s probe geometry, which comes from
`kicad_import.py` parsing the real `.kicad_sch` directly and always uses the
schematic's own refs ("F1", "LED1") for pin placement -- `circuit.cir`'s
component names have always been FaultFinder's own addition, independent of
the source schematic's refs (the same reason every device's power source is
named `V1` regardless of what the schematic's own power symbol is called).

The board has two small copper-fill zones on `F.Cu` (not a large ground
pour like `bridge_rectifier_06`'s) -- every pad is still individually
probeable via the pads list, same pour-hit-testing caveat as every other
real-imported device (this project's PCB view has never supported
zones/pours, see `import_real_pcb.py`'s own docstring).
