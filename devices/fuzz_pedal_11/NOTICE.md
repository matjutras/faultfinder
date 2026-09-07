# Source

Schematic and PCB layout (`fuzz_pedal_11.kicad_sch` / `.kicad_pcb` / `.kicad_pro`)
are imported from:

https://github.com/Circle-Circuits/motherboard

commit b424a9845859456e7e0763ce8855efb0a270da6a ("Publish first version of
Motherboard source and documentation", the only commit that has touched the
KiCad source, as of 2026-09-07). The real KiCad source ships inside
`kicad/motherboard-v1-kicad-archive.zip` in the source repo (GitHub's
Contents API truncates files over 1MB, so this was fetched via the repo's
raw `download_url` and unzipped, not hand-edited).

# License

CERN Open Hardware Licence Version 2 - Permissive (CERN-OHL-P-2.0). Full
text in `LICENSE` in this directory (copied verbatim from the source repo's
`LICENCE` file -- British spelling in the source, renamed here to match
every other device's `LICENSE` filename). Per the license's own terms, the
licence text/notice must be kept with the design, and anyone receiving a
product built from it (or a copy of the source) must be able to access this
same source and notice -- satisfied here by this file plus the verbatim
`LICENSE` copy and the unmodified `.kicad_sch`/`.kicad_pcb` source sitting
alongside it.

# What's real vs. added for FaultFinder

The `.kicad_sch` is imported unmodified except for filename. The
`.kicad_pcb` is the same real board (footprints, placement, and every
routed copper segment are untouched) -- not re-laid-out by
`backend/scripts/build_pcb.py` -- but its whole coordinate origin was
translated (via `backend/scripts/import_real_pcb.py`, a pure `board.Move()`)
so the board's own Edge_Cuts bounding box starts at (0,0). Pure translation.

This is "The Motherboard", an open-source PCB explicitly designed as "a
framework to build any kind of Big Muff circuit" (the classic guitar fuzz
pedal, dating to the 1970s) -- see the source repo's own
`docs/1_About_the_circuit.md` and
[Electrosmash's Big Muff Pi analysis](https://www.electrosmash.com/big-muff-pi-analysis)
for the real circuit's own well-documented theory of operation, which this
device's `circuit.cir` was cross-checked against stage by stage. It's the
sixth real-world import and by far the largest and most complex device in
this repo (73 real components across `circuit.cir`, vs. the largest prior
device's ~15) -- four self/fixed-biased common-emitter BJT gain stages
(2N5089, all sharing one generic default NPN model, the same bar this
project already applies to every other discrete BJT/MOSFET), clipping
diodes (1N914, all sharing one generic default diode model, same bar as
every other device's diodes), a passive tone stack, and multiple
front-panel pots and mode-select toggle switches -- the first device in
this repo to have either.

This is also the first device with a genuine, non-trivial *fault-finding-
relevant* capacitor: `C3`/`C4`/`C6`/`C7`/`C9`/`C12`/`C13`, etc. are all real
coupling/bypass capacitors between amplifier stages (unlike
`bridge_rectifier_06`'s `C1`, a smoothing capacitor that already existed in
this repo's fault pool but was never the point of a real-world import).

## New modeling conventions this device needed (none of the prior five did)

- **A 3-terminal potentiometer** (`R6` SUSTAIN, `R20` TONE, `R25` VOLUME, all
  B100k/B100k/A250k) is modeled as two fixed resistors meeting at the
  wiper's own real net name, each half at 50% of the pot's total value -- a
  fixed "noon" setting, since a static DC operating-point analysis has no
  notion of a control being mid-turn by the player, and no prior device had
  a real 3-terminal pot to establish a convention for. `RV1` (an
  unpopulated 4th "extension header" pot, per the source repo's own docs)
  and its `J1` header are real schematic parts but not populated on a
  standard build, so they're omitted from `circuit.cir` entirely, the same
  "off-board/unpopulated" treatment every other device already gives a
  part that genuinely isn't there.
- **A rheostat-wired pot** (`R27` PITCH, `R26` BLEND, `R30` BODY trim -- both
  non-wiper terminals tied to the same net) collapses to a single resistor
  at 50% of its value between that net and the wiper's net, since there's
  no third distinct node to model.
- **A mode-select toggle switch with no single "off" state** (`SW1`/`SW2`,
  the two clipping-diode selectors; `SW4`, the input-gain selector) is
  fixed at one deliberately chosen position via a small (10 milliohm)
  resistor standing in for the switch's own near-zero contact resistance
  between the two real net names it joins -- not a literal shared SPICE
  node, so both real schematic points stay independently probeable exactly
  as `map.json` exposes them (the same reason `soft_power_switch_10`'s
  dangling-stub convention exists: two genuinely different real probe
  points must never silently collapse into one). `SW1`/`SW2` are fixed at
  the silicon-diode-only position (their germanium-chain and LED-clipping
  alternatives are real board features -- see below -- not a build-time
  jumper choice, so any one fixed position is a legitimate, documented
  choice, the same way a real player's physical toggle position is a
  choice); `SW4` is fixed at the R1/39k ("normal gain") position, not the
  R31/390k ("reduced gain") alternative. `SW6` (the *optional* off-board
  footswitch header for the feedback-loop feature -- a 2-pin header, not an
  onboard toggle, per the source schematic and its own "optional" naming)
  is left disengaged/unconnected, its natural default, the same reasoning
  `soft_power_switch_10`'s unpressed `SW1` button used.
- **A diode "ring" with no external ground reference of its own.** `D3`/
  `D4`/`D5` (second clipping stage) and `D6`/`D7`/`D8` (first clipping
  stage's germanium alternative) are each three diodes in the *same*
  rotational sense forming a closed loop back to their own stage's
  collector -- confirmed from the real netlist, not assumed -- so the ring
  itself carries no net DC current regardless of switch position; only the
  fixed diode pairs actually in the signal path (`D1`/`D2`, silicon,
  anti-parallel) matter for the "healthy" reading. `D9`/`D10` (the LED-
  clipping alternative for the second stage, anti-parallel like `D1`/`D2`)
  dangle for the same reason `SW2`'s unselected throw does. Real
  germanium diodes (`D6`/`D7`/`D8`, silkscreened "Ger.") share the same
  generic default diode model as every silicon diode on this board and
  every diode on every other device in this repo -- this project has never
  had, and still doesn't have, a real sourced germanium SPICE model, so no
  attempt is made to give a germanium diode a lower forward voltage than a
  silicon one; this is the same generic-model bar already accepted
  project-wide, not a new fabrication.
- **A fixed-divider-biased stage alongside self-biased ones.** Q1/Q2/Q3 are
  each self-biased (a resistor plus a small compensation capacitor from
  collector straight back to base, confirmed from the real netlist); Q4
  (the output/recovery stage) instead uses a plain resistor divider from
  `+9V` and GND to its base -- a real, deliberate difference in the source
  schematic, not an inconsistency in this device's own modeling.
- **`.options gmin=1e-9`** is set from the start (unlike
  `soft_power_switch_10`, which added it only after a fault actually failed
  to converge) -- with four cross-coupled feedback stages, the same class of
  regenerative-convergence risk that device's own two solver failures came
  from was expected here too. Every one of the 1061 generated faults was
  actually run through ngspice (not just fault-pool-generated) before this
  device was accepted, per this repo's own dev-workflow rule, and all 1061
  simulate cleanly.

## What's not modeled

`C15`/`C16` (silkscreened "Fuzz War only" on the real board, an alternate
tone-stack configuration for a different, related pedal circuit) are
unpopulated on a standard Big Muff build per the source repo's own docs and
are not in `circuit.cir`, matching the real BOM. `H1`/`H2` (bare test-point
audio jacks), `Switch-Header1` (the main in/out bypass footswitch
connector), and `DC-Header1` (the power jack, replaced by `V1` the same way
every other device's power input is) carry no DC-relevant information of
their own -- the whole audio signal path is AC-coupled through blocking
capacitors at every stage boundary, so (like every other device) this
device's `circuit.cir` only needs to expose each stage's own DC bias point,
never the audio signal itself, which this app has never simulated (no
transient/AC analysis exists in this project). Every pin these connectors
would have driven is either a real onboard net already defined by a real
component (see `R0`, `R25` etc.) or a genuine dangling stub, per the
conventions above.

Every discrete BJT gain stage here uses ngspice's generic default NPN
model, not a real 2N5089 macromodel (none sourced, same bar as every other
device) -- the real 2N5089 is an unusually high-gain part (datasheet hFE
often 400-1200), well above ngspice's generic default beta, so this
device's own healthy-state DC bias points (particularly each stage's
collector voltage, set by self-bias feedback that's sensitive to the
transistor's actual beta) read further from a real built board's own
measured voltages than any prior device's generic-BJT-modeled stage did.
This is the same known, already-accepted generic-model limitation as every
prior device, just more visible here because this device has four cascaded
stages instead of one.
