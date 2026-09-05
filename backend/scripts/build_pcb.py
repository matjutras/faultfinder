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

Placement is a plain grid, and routing (below) is straight point-to-point
copper between same-net pads in placement order -- not DRC-clean/manufacturable
routing (no via/crossing avoidance), since the only thing v1 needs out of the
PCB is a 3D glb for visual/probe purposes (see CLAUDE.md milestone 5). The
goal is just that the board reads as one connected circuit instead of
floating unconnected parts, which a straight chain already achieves given the
simple grid layout with generous pad spacing.

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


class PcbGenError(Exception):
    pass


def _mm(v: float) -> int:
    return int(round(v * 1_000_000))


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

    # Straight point-to-point copper between same-net pads, so the board
    # reads as one connected circuit instead of floating unconnected parts
    # (see module docstring -- not DRC-clean routing, just visual/electrical
    # continuity, which a straight chain already gives with this simple,
    # generously-spaced grid layout).
    track_width = _mm(TRACK_WIDTH_MM)
    for net_name, pads in pads_by_net.items():
        if len(pads) < 2:
            continue
        ordered = sorted(pads, key=lambda p: (p.GetPosition().x, p.GetPosition().y))
        for a, b in zip(ordered, ordered[1:]):
            track = pcbnew.PCB_TRACK(board)
            track.SetStart(a.GetPosition())
            track.SetEnd(b.GetPosition())
            track.SetWidth(track_width)
            track.SetLayer(pcbnew.F_Cu)
            track.SetNet(net_items[net_name])
            board.Add(track)

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
