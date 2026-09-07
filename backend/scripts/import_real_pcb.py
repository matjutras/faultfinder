"""Import an already-real, professionally-routed .kicad_pcb as-is, for a
"real-world imported device" (see CLAUDE.md's own section on these) -- the
opposite of build_pcb.py, which auto-places a *new* board from a
hand-authored schematic. Runs under the *system* python3 for the same
pcbnew-availability reason as build_pcb.py (see its own docstring); invoked
as a subprocess by app/pcb_import.py, never imported by the FastAPI app
directly.

Loads the real board and shifts its whole coordinate origin so the
Edge_Cuts bounding box starts at (0,0): this app's PCB probe view
(frontend/src/kicadCoords.ts) assumes pad/track mm coordinates and
board_size_mm share that origin, which a real board's own absolute page
position essentially never does (confirmed against bridge_rectifier_06's
source file: its Edge_Cuts sat at ~(117, 69.5)mm, not near (0,0)). This is a
pure translation -- board.Move() shifts every footprint/pad/track/drawing by
the same vector, so relative placement and routing are byte-for-byte
untouched, just re-anchored. board_thickness_mm comes from the board's own
real stackup (its design settings), not build_pcb.py's hand-authored-device
default.

Reads net names, pad positions, and routed copper straight off the loaded
board (no schematic netlist involved here -- unlike build_pcb.py, this is
the PCB side, not the schematic side of the import). Net-name normalization
mirrors kicad_import.py's resolve_all_pin_nets / sanitize_spice_node_name
exactly (leading "/" stripped, GND -> "0", any character outside
[A-Za-z0-9_] sanitized -- see that function's own docstring for why) so a
real board's pads/tracks resolve to the exact same node names as its
schematic's pins/wires; kept in sync by hand rather than imported, same
reasoning as build_pcb.py's own duplicated net-name logic (this script runs
under the system python3, not the app's venv).

A real board's ground net is commonly a filled copper zone/pour rather than
discrete traces (true for bridge_rectifier_06) -- this deliberately does not
attempt zone-polygon hit-testing (matching this project's existing PCB view,
which has never supported zones/pours at all, see CLAUDE.md/build_pcb.py's
own "--include-zones" note). Every pad on that net is still a real,
individually probeable point via the pads list, which is enough for the
probe-anywhere gameplay even without pour-copper hit-testing between pads.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import pcbnew


_UNSAFE_NODE_CHAR_RE = re.compile(r"[^A-Za-z0-9_]")

# Real-world KiCad boards commonly place mechanical/enclosure-context
# footprints -- panel-mount jacks, a footswitch, the enclosure body itself --
# physically outside the board's own Edge_Cuts outline, a normal KiCad
# convention for showing off-board panel hardware relative to the PCB for
# mechanical-fit purposes, not a design error. kicad-cli's glb exporter has
# no concept of this: it exports every footprint's pads/silkscreen (and 3D
# model, when one resolves) regardless of position, which renders in the
# app's 3D view as components floating in space, disconnected from the
# actual board -- confirmed on fuzz_pedal_11 (github.com/Circle-Circuits/
# motherboard): its enclosure, two 6.35mm audio jacks, a DC barrel jack, a
# panel footswitch, and a toggle switch are all real, deliberately off-board
# mechanical references in the source, not an import bug. GLB_EXCLUDE_MARGIN_MM
# (not an exact edge match) tolerates ordinary edge-mounted connectors whose
# footprint anchor legitimately sits within a couple mm of the board edge --
# tight enough to still catch fuzz_pedal_11's two 6.35mm jacks, whose anchors
# are only 3.34mm past the edge.
GLB_EXCLUDE_MARGIN_MM = 2.0

_GENERATOR_VERSION_RE = re.compile(r'\(generator_version "([\d.]+)"\)')


def _parse_dotted_version(text: str) -> tuple[int, ...] | None:
    match = _GENERATOR_VERSION_RE.search(text)
    if not match:
        return None
    return tuple(int(p) for p in match.group(1).split("."))


def _installed_kicad_version() -> tuple[int, ...]:
    result = subprocess.run(["kicad-cli", "version"], capture_output=True, text=True, timeout=10)
    return tuple(int(p) for p in result.stdout.strip().split(".") if p.isdigit())


def check_kicad_version_compatible(pcb_path: Path, pcb_text: str) -> None:
    """Same check and same reasoning as app/kicad_import.py's function of the
    same name -- duplicated rather than imported because this script runs
    under the *system* python3 for pcbnew availability (see this module's own
    docstring), not the app's venv. Checked here before pcbnew.LoadBoard()
    rather than left to fail there: a version-mismatched .kicad_pcb is
    exactly the reverse_polarity_08 failure this generalizes (see
    kicad_import.py's docstring for the full incident), and pcbnew.LoadBoard
    on an unparseable file is a crash from inside the pcbnew C++ bindings,
    not a message a future importer could act on."""
    file_version = _parse_dotted_version(pcb_text)
    if file_version is None:
        return
    installed = _installed_kicad_version()
    if file_version[:2] > installed[:2]:
        print(
            f"{pcb_path.name} was authored in KiCad "
            f"{'.'.join(map(str, file_version))}, but only KiCad "
            f"{'.'.join(map(str, installed)) or 'unknown'} is installed. An "
            "older kicad-cli/pcbnew cannot reliably parse a newer file "
            "format. Upgrade the system KiCad install before importing this "
            "device -- see CLAUDE.md's KiCad 9->10 upgrade note.",
            file=sys.stderr,
        )
        sys.exit(1)


def normalize_net_name(name: str) -> str:
    name = name.lstrip("/")
    if name == "GND":
        name = "0"
    if name == "0":
        return name
    name = _UNSAFE_NODE_CHAR_RE.sub("_", name)
    if name and name[0].isdigit():
        name = f"N_{name}"
    return name


def import_real_pcb(pcb_path: Path, glb_source_path: Path) -> dict:
    check_kicad_version_compatible(pcb_path, pcb_path.read_text())
    board = pcbnew.LoadBoard(str(pcb_path))

    bbox = board.GetBoardEdgesBoundingBox()
    board.Move(pcbnew.VECTOR2I(-bbox.GetLeft(), -bbox.GetTop()))
    pcbnew.SaveBoard(str(pcb_path), board)

    all_pads: list[dict] = []
    for fp in board.GetFootprints():
        ref = fp.GetReference()
        for pad in fp.Pads():
            net = pad.GetNetname()
            if not net:
                continue
            pos = pad.GetPosition()
            all_pads.append({
                "ref": ref, "pin": pad.GetNumber(), "node": normalize_net_name(net),
                "x_mm": pos.x / 1_000_000, "y_mm": pos.y / 1_000_000,
            })

    track_manifest: list[dict] = []
    for track in board.GetTracks():
        if track.GetClass() != "PCB_TRACK":
            continue  # vias aren't a 2D segment -- same exclusion build_pcb.py's own manifest makes
        net = track.GetNetname()
        if not net:
            continue
        start, end = track.GetStart(), track.GetEnd()
        track_manifest.append({
            "node": normalize_net_name(net),
            "layer": track.GetLayerName(),
            "x1_mm": start.x / 1_000_000, "y1_mm": start.y / 1_000_000,
            "x2_mm": end.x / 1_000_000, "y2_mm": end.y / 1_000_000,
        })

    new_bbox = board.GetBoardEdgesBoundingBox()
    board_thickness_mm = board.GetDesignSettings().GetBoardThickness() / 1_000_000

    # A *separate* .kicad_pcb (caller-provided path, outside devices/ -- see
    # pcb_import.py, which writes it into its own tempdir and deletes it once
    # the glb export step is done with it, since it's derived output, not
    # real board source), used only for the glb export step -- pcb_path
    # itself (and every pad/track above, both already read off `board` before
    # this mutates it) stays the real, faithful, unmodified board.
    left = new_bbox.GetLeft() / 1_000_000 - GLB_EXCLUDE_MARGIN_MM
    right = new_bbox.GetRight() / 1_000_000 + GLB_EXCLUDE_MARGIN_MM
    top = new_bbox.GetTop() / 1_000_000 - GLB_EXCLUDE_MARGIN_MM
    bottom = new_bbox.GetBottom() / 1_000_000 + GLB_EXCLUDE_MARGIN_MM
    for fp in list(board.GetFootprints()):
        pos = fp.GetPosition()
        x_mm, y_mm = pos.x / 1_000_000, pos.y / 1_000_000
        if not (left <= x_mm <= right and top <= y_mm <= bottom):
            board.Remove(fp)
    pcbnew.SaveBoard(str(glb_source_path), board)

    return {
        "pads": all_pads,
        "tracks": track_manifest,
        "board_size_mm": {
            "width": new_bbox.GetWidth() / 1_000_000,
            "height": new_bbox.GetHeight() / 1_000_000,
        },
        "board_thickness_mm": board_thickness_mm,
        "glb_source_pcb": str(glb_source_path),
    }


if __name__ == "__main__":
    pcb_arg, manifest_arg, glb_source_arg = sys.argv[1], sys.argv[2], sys.argv[3]
    manifest = import_real_pcb(Path(pcb_arg), Path(glb_source_arg))
    Path(manifest_arg).write_text(json.dumps(manifest))
