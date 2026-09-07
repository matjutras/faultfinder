# FaultFinder

Educational electronics trainer: auto-generated schematics and 3D PCB views where the user finds an injected fault using a simulated multimeter/scope. Full architecture and rationale live in the project doc (ask Mat for the link if it's not pasted below this line) — this file is the quick-reference Claude Code actually reads on every turn, not a replacement for it.

## Stack (decided)

- **Frontend:** React + Vite + TypeScript, deployed as a PWA. 3D board view via `@react-three/fiber` + `@react-three/drei` (three.js).
- **Backend:** Python. Shells out directly to `ngspice` (no PySpice) and to `kicad-cli` for the import pipeline — do not add a SPICE-wrapper dependency. Web framework not yet locked in; FastAPI is the default assumption until Mat says otherwise — update this line once decided.
- **Schematic view:** KiCanvas renders `.kicad_sch` client-side. Every component pin and every wire segment is a drag-drop target for the multimeter's leads (milestone 9: literal multimeter UI, replacing the old TP-marker/click-to-place flow from milestone 8) — coordinates come from parsing the KiCad XML netlist (`kicad-cli sch export netlist --format kicadxml`) plus the `.kicad_sch` source itself (wire endpoints, symbol pin offsets), **not** from geometry/label-proximity guessing — that approach was tried early on and produced real mismapped test points. Don't reintroduce it. A lead dropped near a wire snaps to the nearest point *on* the wire (`wireHitTest.ts`/`dropTargets.ts`), not the raw drop pixel. The mm→pixel transform (`kicadCoords.ts`'s `schematicMmToPixels`) takes the device's own page size (`page_width_mm`/`page_height_mm`, parsed off the schematic's `(paper ...)` directive by `kicad_import.py`'s `parse_page_size_mm` and returned by the API) — **not** a hardcoded constant. Every hand-authored device happens to declare a custom 100x110mm page, but a real-world imported device (see below) declares a plain standard sheet like `"A4"`; hardcoding 100x110 silently misplaces every probe on any device that isn't hand-authored (see Known gotchas). KiCanvas's own vendored zoom (`frontend/public/kicanvas.js`) had a real bug (fixed in place, not upstream): its pinch/wheel zoom computed the cursor-anchor world point *after* already mutating the zoom level on both sides of the delta, so the correction was always zero and zoom always pivoted on the camera center. Don't re-vendor a stock copy over this fix without re-patching it.
- **PCB view:** `kicad-cli pcb export glb` (KiCad 9+, native, includes populated component models) loaded via `@react-three/fiber`. A lead dropped on the canvas raycasts from the real camera through the drop point against the board's own top plane (`pcbRaycast.ts`, real three.js `Camera`/`Raycaster`/`Plane` math, no react-three-fiber needed to unit-test it); the resulting board-mm point is hit-tested against the real pad/copper-track manifest (`dropTargets.ts`, sharing `wireHitTest.ts` with the schematic view) to land on a pad or trace. `OrbitControls` needs `zoomToCursor` explicitly enabled (off by default in three.js) so pinch/scroll zoom dollies toward the cursor instead of a fixed point. Watch the Y-flip between PCB coordinates (Y-down) and glTF/three.js (Y-up).
- **Simulation:** `ngspice -b netlist.cir` as a subprocess, server-side, for v1. Client-side WASM ngspice (EEcircuit-style) is a deliberate later upgrade, not a v1 goal — don't build both at once.
- **PCB layout:** `.kicad_pcb` is auto-placed from the schematic by `backend/scripts/build_pcb.py` (pcbnew), not hand-authored — see milestone 5. It also synthesizes a real 2-pin power-input connector (`J1`, a generic `PinHeader_1x02` footprint) wired into the actual routed copper, since the schematic's own voltage source (`Simulation_SPICE:VDC`) is SPICE-only with no footprint and without this the board had no physical place power enters, just passives and probe test points. The positive net is derived generically (whichever net the SPICE source ties to besides `"0"`), never hardcoded as `"VIN"` vs `"VCC"` (that varies per device). Placed at a half-grid-cell offset from the schematic-derived component raster on purpose — landing exactly on-grid caused a real routing short in `resistor_bridge_05` (a different net's copper ran through the exact point another pad's connection needed to pass through). The router is greedy/no-ripup (see the module's own docstring); a newly added pad can still, in principle, create a similar conflict on some future device — if `test_build_pcb_has_no_same_layer_cross_net_track_crossings` ever fails again, that's a real short, not a flaky test.

## Per-device file convention

Generated once per device by the importer (a backend API route, not a distributed local tool):

```
devices/<device_id>/
  device.json     # {id, name, schematic_image}
  map.json        # {id, pins: [{ref, pin, node, x_mm, y_mm}, ...], wires: [{node, x1_mm, y1_mm, x2_mm, y2_mm}, ...], pcb_pads: [...], pcb_tracks: [{node, layer, x1_mm, y1_mm, x2_mm, y2_mm}, ...]}
  faults.json     # [{id, name, difficulty, patch: [{ref, to, ...}]}, ...]
  circuit.cir      # spice_base.cir — patched per-fault before each sim run, never edited directly
  <device>.kicad_sch / .kicad_pcb / pcb.glb   # KiCad source + exports
```

`map.json`'s pins/wires/pads/tracks are derived generically for *every* component and net (milestone 8) — not just `TP`-prefixed refs, though those still exist as dedicated test points for a device that wants labeled points. **Never hardcode canonical net names per device** (e.g. `"/Vin" → "VIN"`); that only works for one board and silently produces nothing for every other device.

### Real-world imported devices

Some devices (`bridge_rectifier_06` on) are real open-source KiCad boards
imported as-is, not hand-authored toy circuits — the point being that a
professionally laid-out and routed board fixes the placement/routing/realism
problems a from-scratch schematic + `build_pcb.py`'s auto-placement kept
running into. They differ from hand-authored devices in a few ways:

- `NOTICE.md` in the device's own folder records the exact source repo URL,
  commit/date, and license (quote the actual license text or file, not just
  "MIT" from memory) plus any attribution the license requires. `LICENSE` is
  a verbatim copy of the source repo's license file.
- The `.kicad_sch`/`.kicad_pcb` (and `.kicad_pro`, if the source repo ships
  one) are the *real* files from the source repo, renamed to
  `<device_id>.*` — never re-laid-out by `backend/scripts/build_pcb.py`,
  which would throw away the real routing that's the entire point of
  importing this board. `backend/app/pcb_import.py` detects a real-imported
  device generically (a `NOTICE.md` in its folder, not a hardcoded device-id
  list) and routes it to `backend/scripts/import_real_pcb.py` instead of
  `build_pcb.py`: that script re-anchors the board's whole coordinate origin
  to (0,0) (a real board's own absolute page position essentially never
  starts there, unlike a hand-authored device's) via a pure `board.Move()` —
  relative placement/routing is untouched, just re-anchored — then reads
  pads/tracks/board size/thickness straight off the real board (see its own
  docstring for the net-name-normalization details this shares with
  `kicad_import.py`). `.gitignore` un-ignores the `.kicad_pcb`/`.kicad_pro`
  per device (see its own comment) since they're committed source here,
  unlike a hand-authored device's auto-placed `.kicad_pcb` — `.kicad_prl`
  stays ignored even for these, since pcbnew regenerates it as pure
  editor-state every time `import_real_pcb.py` loads/saves the board.
  A real board's ground net is commonly a filled copper zone/pour rather
  than discrete traces — every pad on it is still individually probeable,
  but there's no pour-polygon hit-testing, matching this project's PCB view
  never having supported zones at all.
- `circuit.cir` is still hand-authored (same as every device), because a real
  board's off-board connections (mains AC, a transformer secondary, a battery)
  aren't KiCad symbols with SPICE models in the source schematic — model them
  with an equivalent DC/simplified source at that connector, like every other
  device already does at its own input, and say so in `NOTICE.md`. Get net
  names by actually running `kicad-cli sch export netlist --format kicadxml`
  against the real schematic, per this file's own rule above — a real board's
  unlabeled nets come back as KiCad's auto-generated `Net-(REF-PIN)`-style
  names (not clean hand-picked labels like the hand-authored devices'), and
  `kicad_import.py`'s `sanitize_spice_node_name` makes those SPICE-safe.
- Every part must have a genuinely usable SPICE model before the board is
  accepted — ngspice's own generic default model (`.model X D` / `.model X
  NPN`, no parameters) is fine for a plain diode/BJT, same bar the
  hand-authored devices already use, but a 3-terminal IC (a linear regulator,
  an op-amp, an audio power amp) needs a *real* subckt model, sourced from
  somewhere with clear reuse terms and verified against a real ngspice run
  before the board is accepted, not fabricated. If no such model exists for a
  part on an otherwise-good real board, reject the board rather than
  approximate the part — regulator ICs (LM317/LM7805/AMS1117/LM337) hit this
  wall repeatedly when this device category was first built: vendor PSpice
  models exist but are typically encrypted-for-PSpice or gated behind a
  non-redistributable web form, and community-shared alternatives found on
  forums lacked clear licensing.

## Fault types

`open_pin`, `short_to_ground`, `short_to_vcc`, `short_between_nodes`, `component_change` (value drift), `component_failed`, `intermittent`. Auto-generate a default fault pool per device from each component's ref prefix (R→open, C→short+open, D→open+short, L→open, Q→junction-open or leaky-short, U/IC→single-pin-open), applied as a `patch` list against a copy of `circuit.cir` — the schematic/PCB the user sees never changes, only what the probes read back.

## Milestones (build in this order)

1. One hardcoded device end-to-end (static schematic image, click-to-place 2 probes, backend mutates netlist → runs ngspice → returns a voltage)
2. Real KiCanvas rendering + netlist-based pin snapping
3. Fault engine (all types) + easy/medium/hard/random difficulty
4. Second and third device through the importer only, zero app-code changes — this is the check that the pipeline actually generalizes — done (`bridge_rectifier_06`/`simple_led_07`; further confirmed against two more real boards, `reverse_polarity_08`/`battery_protection_09`, which is what surfaced most of the gotchas below)
5. Scoring/game layer (attempts, a session across multiple devices, a "found it" confirmation) — done
6. 3D PCB probing view (glTF + raycasting), sharing probes/instruments with the schematic view — done (was built ahead of order, before milestone 5 existed as a named milestone, but both are done now)
7. (optional) Offline/WASM ngspice for a no-backend PWA
8. Probe placement anywhere (any component pin/pad, or anywhere along a wire/copper trace — not just TP markers) — done
9. Literal multimeter UI: a mode selector (voltage/ohms/diode) plus two draggable leads (red/black) the user drags onto a pin/pad/wire/trace to place, replacing milestone 8's click-to-place TP-marker flow entirely — done

Don't skip ahead to a later milestone until the current one has passing tests and works end-to-end in the browser.

## Dev workflow

- Write tests alongside every feature — don't implement first and add tests as an afterthought.
- Frontend tests: colocated `*.test.ts(x)` next to the code they test, run via the project's configured test runner.
- Backend tests: `backend/tests/`, run via `pytest -v`.
- Before calling a milestone done: both test suites pass, and the feature has been exercised end-to-end in the browser (not just unit-tested in isolation) — SPICE output parsing and the KiCad import pipeline are exactly the kind of thing that passes a mocked unit test and then breaks on a real file. A real page-size bug in the probe overlay (see Known gotchas) shipped past a device's full API-level pipeline check specifically because no browser check ran — API responses looked fine; only the rendered page proved the leads landed on the wrong pixels.
- `frontend/scripts/verify-device.mjs` (Playwright, headless Chromium — `npm install -D @playwright/test && npx playwright install chromium` once per machine) drives a real browser against a running backend+frontend pair to do exactly that check: `node scripts/verify-device.mjs <deviceId> <frontendUrl>` selects the device, drags both leads onto two of its real pins (computed from the API's own pin/page-size data), reveals the fault, switches to PCB view, screenshots it, then drags the PCB canvas to rotate the camera underneath the board and screenshots that too (`<deviceId>-pcb-bottom.png`) — real proof the OrbitControls polar-angle fix (see Known gotchas) actually reaches the underside, not just that the prop is set — and screenshots each step into `/tmp/ff-verify` (or a given `outDir`). Note the ports already in local use: 8000 and 5173 are typically occupied by other long-running local services/dev servers on this machine — run the backend/frontend on different ports for an ad-hoc check (e.g. `--port 8010` / `--port 5180`), and add that frontend origin to `main.py`'s CORS `allow_origins` temporarily (revert before committing; it's not a real deployment origin).
- Don't commit generated per-device output (`devices/*/circuit.cir`, `*.png`, `*.glb` if regenerated) — regenerate from KiCad source. Do commit the KiCad source files themselves.

## Known gotchas

- ngspice's own output is plain text, not JSON — the parser is the most fragile part of the backend. Give it real fixture output from an actual `ngspice -b` run in tests, not hand-written fake output.
- kicad-cli's SPICE netlist export can silently omit components with no SPICE model (e.g. bare test-point symbols) — this is *why* the XML netlist export is used for test-point mapping instead.
- The schematic view's `<kicanvas-embed controls="none">` disables KiCanvas's own interactivity entirely (verified in the vendored source: `disableinteraction = (controls=="none")`, and `interactive` gates whether `enable_pan_and_zoom` is ever called at all) — so schematic pinch/scroll-zoom is not currently reachable in the app regardless of the anchor-point fix in `frontend/public/kicanvas.js`. Turning it on isn't just a prop flip: the drag-drop lead overlay (`dropTargets.ts`'s pin/wire coordinates) is computed from a fixed `schematicMmToPixels` fit-to-container transform that assumes KiCanvas is always shown at that exact static scale/position — enabling real pan/zoom would desync the overlay from the actual rendered schematic the moment the user zooms or pans. Solving that (tracking KiCanvas's live camera transform and reprojecting the overlay against it) is a real feature, not part of this fix.
- The schematic probe overlay used to hardcode a 100x110mm page in `kicadCoords.ts`, because every hand-authored device happened to declare that exact custom page. `bridge_rectifier_06` (the first real-world imported device) declares a plain `"A4"` page instead — its own pins go up to x=129.5mm, which doesn't even fit on a 100mm-wide page — so every probe drop silently landed at the wrong point relative to the real KiCanvas render (KiCanvas itself renders the schematic correctly either way; only the app's own invisible hit-testing overlay was wrong, which a unit test or an API-only check can't catch, only an actual browser render can). Found by a live Playwright check, not assumed. Fixed by threading the schematic's real page size (`page_width_mm`/`page_height_mm`, parsed by `kicad_import.py`'s `parse_page_size_mm`) through the API into `schematicMmToPixels`/`resolveSchematicDropTarget` instead of a constant. If a future device's probes look visually offset from their real pins, check this first.
- `PcbProbeView.tsx`'s `OrbitControls` polar-angle limits were loosened (0.05 to `Math.PI - 0.05`) so the camera can flip past horizontal to view the board's underside — the `.glb` export already includes back-side copper/silkscreen (`--include-tracks`/`--include-zones` in `pcb_import.py`). This is camera-only: `pcbRaycast.ts`'s `screenToBoardMm` raycasts against a single infinite plane fixed at the *top* hit-target height regardless of camera position, so a lead dragged onto a visually-bottom-side pad while looking up from underneath still resolves against the top plane along that ray, not the bottom pad the user is looking at. Real bottom-side probe placement (probing the board from below, not just viewing it) would need the raycast target plane to depend on which side the camera is currently on — not built, since nothing asked for it yet. `verify-device.mjs` now actually exercises this (drags the PCB canvas in small vertical increments and screenshots the result) rather than just asserting the prop values — a single full-container-height drag overshoots back to the starting view, since three.js `OrbitControls`' default `rotateSpeed` maps a full-height drag to a full 2*pi polar rotation.
- Importing `reverse_polarity_08` (a real board authored in KiCad 10) surfaced that `kicad-cli`/`pcbnew` 9.0.8 cannot parse a KiCad 10 file at all — not a version-number guard, genuinely different syntax (confirmed by hand-patching the version/generator header down to a KiCad 9 value and re-running; still failed). Fixed by upgrading the system's KiCad install to 10.0.6 via `ppa:kicad/kicad-10.0-releases` (note the `-releases` suffix — `ppa:kicad/kicad-10.0` alone doesn't exist on Launchpad). That upgrade changed one real, confirmed pcbnew output detail: a `.kicad_pcb` segment's net code is now written quoted (`(net "0")`) where KiCad 9 wrote it bare (`(net 3)`) — `test_build_pcb.py`'s `_SEGMENT_RE` was updated to accept either; this is not a routing regression, the crossing-detection logic itself still finds zero same-layer crossings on every hand-authored device after the upgrade. If importing a future real board fails to parse, check its `(version ...)`/`generator_version` header against the installed `kicad-cli version` before assuming the file itself is broken.
- `parse_page_size_mm`'s `STANDARD_PAPER_SIZES_MM` only had KiCad's A-series sizes until `reverse_polarity_08` (a real board declaring `"(paper "USLetter" portrait)"`) silently fell back to `DEFAULT_PAGE_SIZE_MM` (100x110mm — wildly wrong for an 8.5x11in sheet), the exact page-size bug this table exists to prevent, just never hit by an A-series device before. `USLetter`/`USLegal`/`USLedger` are in the table now. If a future real board's probes look offset and its page size prints as the 100x110 default, check whether its paper size is one of KiCad's US sizes and add it here.
- `fault_gen.py`'s ref-prefix-driven `parse_components`/`_per_component_faults` assume the *KiCad schematic's own* ref designators double as valid SPICE element-type prefixes — true by luck for every hand-authored device and for `bridge_rectifier_06`/`simple_led_07` (whose real designer happened to use "D" for both diodes and LEDs), but false in general. Importing `reverse_polarity_08` hit this: no "M" (MOSFET) case existed at all, so an `M1 <drain> <gate> <source> <bulk> <model>` line fell through to the generic branch and misparsed the trailing model name as a phantom 5th node, which `_net_pair_faults` then shorted a real net to — ngspice can't solve a node with one connection; fixed with a real 4-node "M" case plus a drain-open/drain-source-leaky-short fault pair (see fault_gen.py's own comment for why it's drain-open, not gate-open: an ideal MOSFET model draws zero DC gate current, so a gate-open fault is a silent no-op whenever the healthy circuit already biases the gate near ground through a resistor, unlike a BJT's base-open, which always cuts real base current).
- A real board's ref designators can collide with SPICE's *reserved* element-prefix letters outright, not just this app's own ref-prefix type table above — `battery_protection_09`'s fuse is ref "F1", but SPICE's bare "F" prefix means a current-controlled current source (a 4-argument dependent source), so `circuit.cir` had to rename it to `R4` (it's modeled as a plain resistor) and its LED (ref "LED1") to `D2` (a diode-family element must start with "D"). `circuit.cir`'s own component names have always been independent of the schematic's real refs (same reason every device's source is always `V1`); `map.json`'s probe geometry is unaffected since it comes from `kicad_import.py` parsing the `.kicad_sch` directly. If a future real board's `circuit.cir` throws an ngspice syntax error mentioning "not enough parameters" or similar for a component whose SPICE line otherwise looks right, check whether its ref's first letter collides with a reserved SPICE prefix (`E`, `F`, `G`, `H` are dependent sources; `K` is mutual inductance; `T`/`W`/etc. have their own reserved meanings too) before assuming the netlist itself is wrong.

## Future work (not started — don't build yet)

- **Capacitance mode.** Voltage, resistance/ohms, and diode-test modes are all built (`backend/app/dmm.py` for ohms/diode: zero the circuit's own independent sources in a copy of the netlist, inject a small test current between the two probe points, run ngspice, read back resistance or forward-voltage drop; `Multimeter.tsx` for the mode selector). Capacitance is deliberately not started — there's no capacitor-bearing device yet to verify it against (see this file's own dev-workflow rule: verify a mode against real output before calling it done). Build it once a capacitor device exists.
