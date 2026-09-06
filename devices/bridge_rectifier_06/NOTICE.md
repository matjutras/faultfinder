# Source

Schematic and PCB layout (`bridge_rectifier_06.kicad_sch` / `.kicad_pcb` /
`.kicad_pro`) are imported from:

https://github.com/VikramR3/ACtoDC_Converter

commit at the time of import: HEAD of `main` as of 2026-09-06.

# License

MIT License, Copyright (c) 2025 Vikram. Full text in `LICENSE` in this
directory (copied verbatim from the source repo). Per the MIT License's own
terms, that copyright notice and license text must be kept with any copy or
substantial portion of this schematic/PCB.

# What's real vs. added for FaultFinder

The `.kicad_sch` is imported unmodified except for filename. The `.kicad_pcb`
is the same real, professionally-routed board (footprints, placement, and
every routed copper segment are untouched) -- not re-laid-out by
`backend/scripts/build_pcb.py` (see this repo's CLAUDE.md, "Real-world
imported devices") -- but its whole coordinate origin was translated (via
`backend/scripts/import_real_pcb.py`, a pure `board.Move()`) so the board's
own Edge_Cuts bounding box starts at (0,0) instead of the source file's
absolute page position (~(117, 69.5)mm): this app's PCB probe view assumes
that origin, which a real board's own sheet placement essentially never
matches. Pure translation -- relative placement/routing is identical to the
source file, just re-anchored.

`circuit.cir` is FaultFinder's own addition (as for every device): the real
board expects an external AC transformer secondary at J1, which isn't a
KiCad symbol with a SPICE model in the source schematic, so `circuit.cir`
drives it with an equivalent DC test source (`V1`, 12V) rather than
fabricating a transformer/AC model -- the same simplification every other
device in this project already makes at its own input. D1-D5 use ngspice's
generic default diode model (`.model DMOD D`), the same generic-model
convention already used by `diode_indicator_03` and `transistor_switch_04`;
1N4007 and a generic LED don't need a part-specific macromodel for a bridge
rectifier's DC operating point.

The real board's GND net is a filled copper zone/pour on B.Cu, not discrete
traces -- every GND pad is still individually probeable (6 of them: C1, R1,
D2, D4, D5, J2), but there's no pour-polygon hit-testing between pads, since
this project's PCB probe view has never supported zones (see
`import_real_pcb.py`'s own docstring).
