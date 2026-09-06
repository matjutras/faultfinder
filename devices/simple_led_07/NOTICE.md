# Source

Schematic and PCB layout (`simple_led_07.kicad_sch` / `.kicad_pcb` /
`.kicad_pro`) are imported from:

https://github.com/VikramR3/Simple_LED

commit at the time of import: b49d01e3b5b40631c02885a3970b817442e6ff45 (HEAD
of `main` as of 2026-09-06).

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
absolute page position: this app's PCB probe view assumes that origin, which
a real board's own sheet placement essentially never matches. Pure
translation -- relative placement/routing is identical to the source file,
just re-anchored.

`circuit.cir` is FaultFinder's own addition (as for every device): the real
board takes power from an off-board 2-pin screw terminal (J1), which isn't a
KiCad symbol with a SPICE model in the source schematic, so `circuit.cir`
drives it with an equivalent DC test source (`V1`, 9V) rather than
fabricating a connector model -- the same simplification every other device
in this project already makes at its own input. D1-D5 use a generic ngspice
default diode model (`.model LEDMOD D`), the same generic-model convention
already used by `diode_indicator_03` and `bridge_rectifier_06`'s own LED
(D5) -- this board's LEDs don't need a part-specific macromodel for a
current-limiting-resistor operating point.

The board has no ground pour/zone -- GND is a single net routed the same as
every other net (a plain 2-layer board, no filled copper regions), so unlike
`bridge_rectifier_06` there's nothing here that isn't already fully captured
by discrete pad/track hit-testing.
