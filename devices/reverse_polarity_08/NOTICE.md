# Source

Schematic and PCB layout (`reverse_polarity_08.kicad_sch` / `.kicad_pcb` /
`.kicad_pro`) are imported from:

https://github.com/sbarabe/SBK_RP1

commit 375f87807fe39f2dbdf0b287e987e2e6c389ea49 (HEAD of `main` as of
2026-08-04, the only commit that has touched the KiCad source).

The source files are in KiCad 10's file format (`(version 20260306)`,
`generator_version "10.0"`) -- newer than every other device in this repo,
all of which were authored in KiCad 9. `kicad-cli`/`pcbnew` 9.0.8 genuinely
cannot parse a KiCad 10 file (confirmed: even after hand-patching the
version/generator header down to a KiCad-9 value, `kicad-cli sch export
netlist` still failed with "Failed to load schematic" -- the file has real
KiCad-10-only syntax, not just a version-number guard), so this import
required upgrading the system's KiCad install to 10.0.6 via KiCad's own
`ppa:kicad/kicad-10.0-releases`. The full backend test suite (86 tests) was
re-run clean after the upgrade; one test (`test_build_pcb.py`'s same-layer
track-crossing regression test) needed its raw-`.kicad_pcb`-text regex
updated for a real, confirmed KiCad 10 pcbnew output change (`(net "0")`,
quoted, vs KiCad 9's bare `(net 3)`) -- not a routing regression, the
crossing-detection logic itself still finds zero same-layer crossings on
every hand-authored device.

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
re-anchored. The real board is genuinely routed on both copper layers with
vias (9 `B.Cu` copper references and 4 real `F.Cu`<->`B.Cu` vias in the
source `.kicad_pcb`, mostly stitching the ground pour) -- not a single-layer
board.

`circuit.cir` is FaultFinder's own addition (as for every device): the real
board takes power from an external battery/supply at J1 (2-12 VDC per the
source repo's own README), which isn't a KiCad symbol with a SPICE model in
the source schematic, so `circuit.cir` drives it with an equivalent DC test
source (`V1`, 9V, a representative point in that range) rather than
fabricating a battery/connector model -- the same simplification every other
device in this project already makes at its own input.

Q1 (an AO3401A P-channel MOSFET, the board's actual reverse-polarity-blocking
element) uses ngspice's generic default PMOS model (`.model PMOSMOD PMOS`,
no parameters) -- the same bar this project already applies to a plain
discrete diode/BJT (see CLAUDE.md), extended here to a plain discrete
MOSFET: a real subckt model is only required for a multi-transistor IC
package (a regulator, an op-amp), not a single discrete 3-terminal part like
this one. D1 (a red status LED) uses the same generic default diode model
convention as every other device's LEDs.

Two component types needed a case this project's generic SPICE-parsing code
didn't have yet, found importing this device:

- `backend/app/fault_gen.py`'s `parse_components` had no MOSFET case at all
  -- an "M"-prefixed line fell through to the generic branch, which
  misparsed the trailing model name (`PMOSMOD`) as a phantom 5th "node".
  `_net_pair_faults` then generated a real fault that shorted an actual net
  to that phantom, single-connection node -- ngspice can't solve a node with
  only one element on it. Fixed generically (a 4-node case for prefix "M",
  plus a gate-open/drain-source-leaky-short fault pair mirroring the
  existing BJT case), not special-cased to this device -- see the function's
  own updated docstring/tests.
- Q1's own component name in `circuit.cir` is `M1`, not the schematic's real
  ref "Q1": SPICE's `M` prefix is the universal syntax for a MOSFET element
  (same reason `circuit.cir` always calls its own source `V1` regardless of
  the schematic's power-symbol name) -- `map.json`'s probe geometry still
  uses the real schematic ref "Q1" for pin placement, since that comes from
  `kicad_import.py` parsing the `.kicad_sch` directly, independent of
  `circuit.cir`'s own component naming.

Unlike `bridge_rectifier_06` (one pour, GND only), this board fills all
three of its nets as copper zones/pours on `F.Cu` (`VIN`, `VOUT`, and `GND`
-- `GND`'s pour spans both `F.Cu` and `B.Cu`, stitched together by the 4 real
vias noted above), not discrete traces. Every pad on every one of those nets
is still individually probeable via the pads list, just without
pour-polygon hit-testing between pads (this project's PCB view has never
supported zones/pours, see `import_real_pcb.py`'s own docstring) -- so a
probe placed mid-pour rather than directly on a pad won't resolve on this
device, more noticeably than on any prior device since here it's true of
nearly the whole board, not just its ground net.
