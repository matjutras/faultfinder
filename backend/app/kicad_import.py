"""Importing test points from real KiCad source (see repo CLAUDE.md).

Net identity (which net a TP-prefixed ref sits on) comes from kicad-cli's XML
netlist export -- this is what replaces the old label/geometry-proximity guessing
that produced mismapped test points. Placement (x/y, in mm, sheet coordinates)
comes from the raw .kicad_sch symbol placement directly, since the XML netlist
doesn't carry schematic geometry.
"""
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

from . import devices

AT_RE = re.compile(r"\(at ([-\d.]+) ([-\d.]+) ([-\d.]+)\)")
REFERENCE_RE = re.compile(r'\(property "Reference" "([^"]+)"')


class KicadCliError(Exception):
    pass


def export_netlist_xml(sch_path: Path) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        out_path = Path(tmp) / "netlist.xml"
        result = subprocess.run(
            ["kicad-cli", "sch", "export", "netlist", "--format", "kicadxml", "--output", str(out_path), str(sch_path)],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise KicadCliError(result.stderr or result.stdout)
        return out_path.read_text()


def resolve_testpoint_nets(netlist_xml: str) -> dict[str, str]:
    """Map each TP-prefixed ref to its net name, normalizing KiCad's conventions
    to match the SPICE node names used in circuit.cir: a leading "/" (KiCad's
    sheet-path prefix for local labels) is stripped, and the power-symbol net
    "GND" is mapped to ngspice's ground node "0" -- both are universal SPICE/KiCad
    conventions, not per-device net names, so this doesn't run afoul of the
    "never hardcode canonical net names per device" rule.
    """
    root = ET.fromstring(netlist_xml)
    net_by_ref: dict[str, str] = {}
    nets = root.find("nets")
    if nets is None:
        return net_by_ref
    for net in nets:
        name = net.get("name", "").lstrip("/")
        if name == "GND":
            name = "0"
        for node in net:
            ref = node.get("ref", "")
            if ref.startswith("TP"):
                net_by_ref[ref] = name
    return net_by_ref


def _top_level_blocks(sch_text: str):
    depth = 0
    start = None
    for i, c in enumerate(sch_text):
        if c == "(":
            depth += 1
            if depth == 2:
                start = i
        elif c == ")":
            if depth == 2:
                yield sch_text[start : i + 1]
            depth -= 1


def parse_symbol_placements(sch_text: str) -> dict[str, tuple[float, float]]:
    """Map each TP-prefixed ref to its (x_mm, y_mm) placement, read directly from
    the schematic's own symbol instances (not the lib_symbols cache)."""
    placements: dict[str, tuple[float, float]] = {}
    for block in _top_level_blocks(sch_text):
        if not block.startswith("(symbol") or "(lib_id" not in block:
            continue
        ref_match = REFERENCE_RE.search(block)
        at_match = AT_RE.search(block)
        if not ref_match or not at_match:
            continue
        ref = ref_match.group(1)
        if not ref.startswith("TP"):
            continue
        placements[ref] = (float(at_match.group(1)), float(at_match.group(2)))
    return placements


def parse_testpoints(netlist_xml: str, sch_text: str) -> list[dict]:
    nets = resolve_testpoint_nets(netlist_xml)
    placements = parse_symbol_placements(sch_text)

    missing = set(nets) ^ set(placements)
    if missing:
        raise ValueError(f"testpoint refs disagree between netlist and schematic: {sorted(missing)}")

    testpoints = []
    for ref in sorted(nets):
        node = nets[ref]
        x_mm, y_mm = placements[ref]
        testpoints.append(
            {
                "tp_id": ref,
                "label": f"{ref} ({node})",
                "node": node,
                "x_mm": x_mm,
                "y_mm": y_mm,
            }
        )
    return testpoints


def import_testpoints(device_id: str) -> list[dict]:
    sch_path = devices.device_dir(device_id) / f"{device_id}.kicad_sch"
    netlist_xml = export_netlist_xml(sch_path)
    sch_text = sch_path.read_text()
    return parse_testpoints(netlist_xml, sch_text)
