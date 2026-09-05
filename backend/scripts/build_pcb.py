"""Generate a minimally-placed .kicad_pcb from a device's schematic, headless.

Runs under the *system* python3 (apt's kicad ships pcbnew only there, not into
arbitrary venvs) -- see CLAUDE.md's PCB view section. Invoked as a subprocess
by app/pcb_import.py, never imported by the FastAPI app directly.

No kicad-cli/pcbnew subcommand does "update PCB from schematic" headlessly in
KiCad 9 (checked: `kicad-cli pcb --help` has no import/netlist subcommand, and
the pcbnew SWIG bindings expose no NETLIST/NETLIST_READER class). So this
reuses the same `kicad-cli sch export netlist --format kicadxml` the
schematic-side importer already produces, and drives placement + net
assignment from it directly via the pcbnew API.

Placement is a plain grid. Routing (below) is orthogonal (Manhattan) copper
between same-net pads in placement order, with real crossing detection: a
new segment that would overlap another net's segment on the same layer (an
actual DRC violation, not just visually messy -- copper doesn't know which
net it's "supposed" to be) drops to the back copper layer with a via at each
end instead. Not a real autorouter (no ripup/retry, no attempt at a shortest
or prettiest path -- just orthogonal-with-a-fallback-layer), since the only
thing v1 needs out of the PCB is a 3D glb for visual/probe purposes (see
CLAUDE.md milestone 5), but every trace is a real, non-crossing copper path,
verified per-device against the actual emitted segment geometry, not assumed
from "it compiled."

Footprint choice is generic across devices: keyed by the schematic symbol's
libsource `part` name (e.g. "R", "D", "TestPoint"), same spirit as
fault_gen.py's ref-prefix table. Extend DEFAULT_FOOTPRINT when a new part type
shows up -- never hardcode a footprint choice per device.

A component whose libsource `lib` is "Simulation_SPICE" is a SPICE-only
stimulus symbol (e.g. a VDC source standing in for the multimeter/PSU) with no
physical footprint -- skipped generically via that lib name, not by ref.
"""
import json
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

import pcbnew

FP_LIB_DIR = Path("/usr/share/kicad/footprints")
SKIP_LIBS = {"Simulation_SPICE"}

# part name -> (footprint library dir, footprint name)
DEFAULT_FOOTPRINT: dict[str, tuple[str, str]] = {
    "R": ("Resistor_SMD.pretty", "R_0805_2012Metric"),
    "C": ("Capacitor_SMD.pretty", "C_0805_2012Metric"),
    "D": ("Diode_SMD.pretty", "D_SOD-123"),
    "LED": ("LED_SMD.pretty", "LED_0805_2012Metric"),
    "TestPoint": ("TestPoint.pretty", "TestPoint_Pad_D1.5mm"),
    "Q_NPN": ("Package_TO_SOT_SMD.pretty", "SOT-23"),
}

GRID_PITCH_MM = 12
MARGIN_MM = 6
BOARD_THICKNESS_MM = 1.51  # KiCad's default stackup total; fixed since we never customize it
TRACK_WIDTH_MM = 0.25
VIA_WIDTH_MM = 0.6
VIA_DRILL_MM = 0.3

Point = tuple[float, float]


class PcbGenError(Exception):
    pass


def _mm(v: float) -> int:
    return int(round(v * 1_000_000))


def _orient(a: Point, b: Point, c: Point) -> int:
    val = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    if abs(val) < 1e-6:
        return 0
    return 1 if val > 0 else -1


def _on_segment(a: Point, b: Point, c: Point) -> bool:
    return (min(a[0], b[0]) - 1e-6 <= c[0] <= max(a[0], b[0]) + 1e-6
            and min(a[1], b[1]) - 1e-6 <= c[1] <= max(a[1], b[1]) + 1e-6)


def _segments_intersect(p1: Point, p2: Point, p3: Point, p4: Point) -> bool:
    """True if segment p1-p2 crosses p3-p4 -- sharing just an *endpoint* (a
    connection, not a crossing) doesn't count, since two different nets'
    segments are never supposed to share an endpoint anyway, and this also
    lets a segment touch its own chain's neighbor without tripping itself."""
    if {p1, p2} & {p3, p4}:
        return False
    o1, o2, o3, o4 = _orient(p1, p2, p3), _orient(p1, p2, p4), _orient(p3, p4, p1), _orient(p3, p4, p2)
    if o1 != o2 and o3 != o4:
        return True
    if o1 == 0 and _on_segment(p1, p2, p3):
        return True
    if o2 == 0 and _on_segment(p1, p2, p4):
        return True
    if o3 == 0 and _on_segment(p3, p4, p1):
        return True
    if o4 == 0 and _on_segment(p3, p4, p2):
        return True
    return False


def _l_route(p1: Point, p2: Point, bend: str) -> list[Point]:
    """Two-segment orthogonal path between arbitrary points -- 'hv' bends at
    (x2,y1), 'vh' at (x1,y2). Degenerates to one segment if already aligned."""
    if p1[0] == p2[0] or p1[1] == p2[1]:
        return [p1, p2]
    corner = (p2[0], p1[1]) if bend == "hv" else (p1[0], p2[1])
    return [p1, corner, p2]


def _export_netlist_xml(sch_path: Path) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        out_path = Path(tmp) / "netlist.xml"
        result = subprocess.run(
            ["kicad-cli", "sch", "export", "netlist", "--format", "kicadxml",
             "--output", str(out_path), str(sch_path)],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            raise PcbGenError(result.stderr or result.stdout)
        return out_path.read_text()


def _footprint_key(ref: str, part: str) -> str | None:
    if part in DEFAULT_FOOTPRINT:
        return part
    if ref.startswith("TP"):
        return "TestPoint"
    return None


def build_pcb(sch_path: Path, out_pcb_path: Path) -> dict:
    """Returns a manifest: pad positions per TP ref, plus board metadata."""
    root = ET.fromstring(_export_netlist_xml(sch_path))

    comps: dict[str, dict] = {}
    for comp in root.find("components"):
        ref = comp.get("ref")
        libsource = comp.find("libsource")
        comps[ref] = {"lib": libsource.get("lib"), "part": libsource.get("part")}

    net_by_pin: dict[tuple[str, str], str] = {}
    for net in root.find("nets"):
        name = net.get("name").lstrip("/")
        if name == "GND":
            name = "GND"
        for node in net:
            net_by_pin[(node.get("ref"), node.get("pin"))] = name

    placeable = sorted(
        ref for ref, info in comps.items()
        if info["lib"] not in SKIP_LIBS and _footprint_key(ref, info["part"]) is not None
    )
    unplaceable = sorted(
        ref for ref, info in comps.items()
        if info["lib"] not in SKIP_LIBS and _footprint_key(ref, info["part"]) is None
    )
    if unplaceable:
        raise PcbGenError(
            f"no default footprint for {unplaceable} (add their part name to "
            f"DEFAULT_FOOTPRINT in build_pcb.py)"
        )

    board = pcbnew.BOARD()

    net_items = {}
    for name in sorted({n for n in net_by_pin.values()}):
        ni = pcbnew.NETINFO_ITEM(board, name)
        board.Add(ni)
        net_items[name] = ni

    cols = max(1, int(len(placeable) ** 0.5 + 0.999))
    pads_by_ref: dict[str, dict] = {}
    pads_by_net: dict[str, list] = {}
    for i, ref in enumerate(placeable):
        info = comps[ref]
        key = _footprint_key(ref, info["part"])
        lib_folder, fp_name = DEFAULT_FOOTPRINT[key]
        fp = pcbnew.FootprintLoad(str(FP_LIB_DIR / lib_folder), fp_name)
        if fp is None:
            raise PcbGenError(f"footprint not found: {lib_folder}:{fp_name} (for {ref})")
        fp.SetReference(ref)
        x_mm = MARGIN_MM + (i % cols) * GRID_PITCH_MM
        y_mm = MARGIN_MM + (i // cols) * GRID_PITCH_MM
        fp.SetPosition(pcbnew.VECTOR2I(_mm(x_mm), _mm(y_mm)))
        board.Add(fp)

        for pad in fp.Pads():
            net_name = net_by_pin.get((ref, pad.GetNumber()))
            if net_name and net_name in net_items:
                pad.SetNet(net_items[net_name])
                pads_by_net.setdefault(net_name, []).append(pad)

        if ref.startswith("TP"):
            pads_by_ref[ref] = {"x_mm": x_mm, "y_mm": y_mm}

    # Orthogonal copper between same-net pads, so the board reads as one
    # connected circuit instead of floating unconnected parts -- with real
    # crossing detection (see module docstring): a segment that would overlap
    # another net's segment on the same layer drops to the back layer with a
    # via at each end instead, exactly like a real 2-layer board routes a
    # crossing that a single layer can't.
    track_width = _mm(TRACK_WIDTH_MM)
    front_segments: list[tuple[Point, Point]] = []
    back_segments: list[tuple[Point, Point]] = []
    vias_placed: set[Point] = set()

    def _to_mm(pad) -> Point:
        pos = pad.GetPosition()
        return (pos.x / 1_000_000, pos.y / 1_000_000)

    def _place_via(pt: Point, net_item):
        if pt in vias_placed:
            return
        via = pcbnew.PCB_VIA(board)
        via.SetPosition(pcbnew.VECTOR2I(_mm(pt[0]), _mm(pt[1])))
        via.SetViaType(pcbnew.VIATYPE_THROUGH)
        via.SetWidth(_mm(VIA_WIDTH_MM))
        via.SetDrill(_mm(VIA_DRILL_MM))
        via.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
        via.SetNet(net_item)
        board.Add(via)
        vias_placed.add(pt)

    def _place_segment(a: Point, b: Point, net_item):
        crosses_front = any(_segments_intersect(a, b, *other) for other in front_segments)
        layer = pcbnew.B_Cu if crosses_front else pcbnew.F_Cu
        if crosses_front:
            _place_via(a, net_item)
            _place_via(b, net_item)
        track = pcbnew.PCB_TRACK(board)
        track.SetStart(pcbnew.VECTOR2I(_mm(a[0]), _mm(a[1])))
        track.SetEnd(pcbnew.VECTOR2I(_mm(b[0]), _mm(b[1])))
        track.SetWidth(track_width)
        track.SetLayer(layer)
        track.SetNet(net_item)
        board.Add(track)
        (back_segments if crosses_front else front_segments).append((a, b))

    def _front_crossings(path: list[Point]) -> int:
        return sum(
            any(_segments_intersect(p1, p2, *other) for other in front_segments)
            for p1, p2 in zip(path, path[1:])
        )

    for net_name in sorted(pads_by_net):
        pads = pads_by_net[net_name]
        if len(pads) < 2:
            continue
        ordered = sorted(pads, key=lambda p: (p.GetPosition().x, p.GetPosition().y))
        net_item = net_items[net_name]
        for pad_a, pad_b in zip(ordered, ordered[1:]):
            a, b = _to_mm(pad_a), _to_mm(pad_b)
            # try both bend directions against what's already on the front
            # layer, and take whichever needs fewer of its (up to 2) segments
            # to fall back to the back layer -- a cheap way to avoid an
            # unnecessary via when the other bend direction would clear fine
            hv, vh = _l_route(a, b, "hv"), _l_route(a, b, "vh")
            path = hv if _front_crossings(hv) <= _front_crossings(vh) else vh
            for p1, p2 in zip(path, path[1:]):
                _place_segment(p1, p2, net_item)

    rows = max(1, -(-len(placeable) // cols))
    # components span [MARGIN, MARGIN + (n-1)*PITCH] on each axis, so a board
    # from (0,0) to this size gives MARGIN clearance on every edge.
    board_width_mm = 2 * MARGIN_MM + (cols - 1) * GRID_PITCH_MM
    board_height_mm = 2 * MARGIN_MM + (rows - 1) * GRID_PITCH_MM

    outline = pcbnew.PCB_SHAPE(board, pcbnew.SHAPE_T_RECT)
    outline.SetLayer(pcbnew.Edge_Cuts)
    outline.SetStart(pcbnew.VECTOR2I(_mm(0), _mm(0)))
    outline.SetEnd(pcbnew.VECTOR2I(_mm(board_width_mm), _mm(board_height_mm)))
    board.Add(outline)

    out_pcb_path.parent.mkdir(parents=True, exist_ok=True)
    pcbnew.SaveBoard(str(out_pcb_path), board)

    return {
        "pads": pads_by_ref,
        "board_size_mm": {"width": board_width_mm, "height": board_height_mm},
        "board_thickness_mm": BOARD_THICKNESS_MM,
    }


if __name__ == "__main__":
    sch_arg, out_pcb_arg, manifest_arg = sys.argv[1], sys.argv[2], sys.argv[3]
    try:
        manifest = build_pcb(Path(sch_arg), Path(out_pcb_arg))
    except PcbGenError as e:
        print(f"PcbGenError: {e}", file=sys.stderr)
        sys.exit(1)
    Path(manifest_arg).write_text(json.dumps(manifest))
