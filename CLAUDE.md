# FaultFinder

Educational electronics trainer: auto-generated schematics and 3D PCB views where the user finds an injected fault using a simulated multimeter/scope. Full architecture and rationale live in the project doc (ask Mat for the link if it's not pasted below this line) — this file is the quick-reference Claude Code actually reads on every turn, not a replacement for it.

## Stack (decided)

- **Frontend:** React + Vite + TypeScript, deployed as a PWA. 3D board view via `@react-three/fiber` + `@react-three/drei` (three.js).
- **Backend:** Python. Shells out directly to `ngspice` (no PySpice) and to `kicad-cli` for the import pipeline — do not add a SPICE-wrapper dependency. Web framework not yet locked in; FastAPI is the default assumption until Mat says otherwise — update this line once decided.
- **Schematic view:** KiCanvas renders `.kicad_sch` client-side. Pin/net coordinates for click targets come from parsing the KiCad XML netlist (`kicad-cli sch export netlist --format kicadxml`), **not** from geometry/label-proximity guessing — that approach was tried and produced real mismapped test points on a first pass. Don't reintroduce it.
- **PCB view:** `kicad-cli pcb export glb` (KiCad 9+, native, includes populated component models) loaded via `@react-three/fiber`. Probe hit-testing uses invisible hit-target meshes placed at pad X/Y from `.kicad_pcb`, picked with a three.js `Raycaster`. Watch the Y-flip between PCB coordinates (Y-down) and glTF/three.js (Y-up).
- **Simulation:** `ngspice -b netlist.cir` as a subprocess, server-side, for v1. Client-side WASM ngspice (EEcircuit-style) is a deliberate later upgrade, not a v1 goal — don't build both at once.

## Per-device file convention

Generated once per device by the importer (a backend API route, not a distributed local tool):

```
devices/<device_id>/
  device.json     # {id, name, schematic_image}
  map.json        # {id, testpoints: [{tp_id, label, node, x, y}, ...]}
  faults.json     # [{id, name, difficulty, patch: [{ref, to, ...}]}, ...]
  circuit.cir      # spice_base.cir — patched per-fault before each sim run, never edited directly
  <device>.kicad_sch / .kicad_pcb / pcb.glb   # KiCad source + exports
```

`testpoints` in `map.json` are derived generically — any `TP`-prefixed ref, resolved via the netlist export. **Never hardcode canonical net names per device** (e.g. `"/Vin" → "VIN"`); that only works for one board and silently produces nothing for every other device.

## Fault types

`open_pin`, `short_to_ground`, `short_to_vcc`, `short_between_nodes`, `component_change` (value drift), `component_failed`, `intermittent`. Auto-generate a default fault pool per device from each component's ref prefix (R→open, C→short+open, D→open+short, L→open, Q→junction-open or leaky-short, U/IC→single-pin-open), applied as a `patch` list against a copy of `circuit.cir` — the schematic/PCB the user sees never changes, only what the probes read back.

## Milestones (build in this order)

1. One hardcoded device end-to-end (static schematic image, click-to-place 2 probes, backend mutates netlist → runs ngspice → returns a voltage)
2. Real KiCanvas rendering + netlist-based pin snapping
3. Fault engine (all types) + easy/medium/hard/random difficulty
4. Second and third device through the importer only, zero app-code changes — this is the check that the pipeline actually generalizes
5. Scoring/game layer (attempts, a session across multiple devices, a "found it" confirmation) — in progress
6. 3D PCB probing view (glTF + raycasting), sharing probes/instruments with the schematic view — already partially built ahead of order (this landed before milestone 5); finish milestone 5 before building further on it
7. (optional) Offline/WASM ngspice for a no-backend PWA

Don't skip ahead to a later milestone until the current one has passing tests and works end-to-end in the browser.

## Dev workflow

- Write tests alongside every feature — don't implement first and add tests as an afterthought.
- Frontend tests: colocated `*.test.ts(x)` next to the code they test, run via the project's configured test runner.
- Backend tests: `backend/tests/`, run via `pytest -v`.
- Before calling a milestone done: both test suites pass, and the feature has been exercised end-to-end in the browser (not just unit-tested in isolation) — SPICE output parsing and the KiCad import pipeline are exactly the kind of thing that passes a mocked unit test and then breaks on a real file.
- Don't commit generated per-device output (`devices/*/circuit.cir`, `*.png`, `*.glb` if regenerated) — regenerate from KiCad source. Do commit the KiCad source files themselves.

## Known gotchas

- ngspice's own output is plain text, not JSON — the parser is the most fragile part of the backend. Give it real fixture output from an actual `ngspice -b` run in tests, not hand-written fake output.
- kicad-cli's SPICE netlist export can silently omit components with no SPICE model (e.g. bare test-point symbols) — this is *why* the XML netlist export is used for test-point mapping instead.
