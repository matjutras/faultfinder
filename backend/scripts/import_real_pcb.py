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
import sys
from pathlib import Path

import pcbnew


_UNSAFE_NODE_CHAR_RE = re.compile(r"[^A-Za-z0-9_]")


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


def import_real_pcb(pcb_path: Path) -> dict:
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

    return {
        "pads": all_pads,
        "tracks": track_manifest,
        "board_size_mm": {
            "width": new_bbox.GetWidth() / 1_000_000,
            "height": new_bbox.GetHeight() / 1_000_000,
        },
        "board_thickness_mm": board_thickness_mm,
    }


if __name__ == "__main__":
    pcb_arg, manifest_arg = sys.argv[1], sys.argv[2]
    manifest = import_real_pcb(Path(pcb_arg))
    Path(manifest_arg).write_text(json.dumps(manifest))
