"""Importing probe geometry from real KiCad source (see repo CLAUDE.md).

Milestone 8 (probe placement anywhere): generalizes what used to be TP-only
extraction to every pin of every component, plus every wire segment -- a
probe should be placeable on any pin or anywhere along a wire, not just at a
dedicated TestPoint symbol. Net identity for a pin comes from kicad-cli's XML
netlist export, same as before. Net identity for a *wire* segment isn't in
that XML at all (it only lists pins), so it's derived here: union-find over
wire endpoints groups wires into connected regions, and a region's net is
whichever pin's exact position falls in it -- exact-coordinate matching only,
the same "no proximity-guessing" principle this importer has always used.
"""
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

from . import devices

AT_RE = re.compile(r"\(at ([-\d.]+) ([-\d.]+) ([-\d.]+)\)")
REFERENCE_RE = re.compile(r'\(property "Reference" "([^"]+)"')
PAPER_RE = re.compile(r'\(paper "([^"]+)"([^)]*)\)')

Point = tuple[float, float]

DEFAULT_PAGE_SIZE_MM: tuple[float, float] = (100.0, 110.0)  # every hand-authored device's own "(paper "User" 100 110)"

# (portrait width, portrait height) in mm, per KiCad's own standard sheet sizes.
STANDARD_PAPER_SIZES_MM: dict[str, tuple[float, float]] = {
    "A5": (148.0, 210.0),
    "A4": (210.0, 297.0),
    "A3": (297.0, 420.0),
    "A2": (420.0, 594.0),
    "A1": (594.0, 841.0),
    "A0": (841.0, 1189.0),
}


def parse_page_size_mm(sch_text: str) -> tuple[float, float]:
    """A real-world imported board declares a plain standard sheet (e.g.
    "(paper "A4")"), not this project's own hand-authored "(paper "User" 100
    110)" convention that the schematic-view probe overlay used to assume
    was universal (kicadCoords.ts's PAGE_WIDTH_MM/PAGE_HEIGHT_MM, hardcoded
    100x110) -- found because bridge_rectifier_06's real pin coordinates
    (up to x=129.5mm) don't even fit inside a 100mm-wide page. KiCad's own
    default orientation for a named standard size, absent an explicit
    "portrait" keyword, is landscape (width and height swapped from this
    table, which stores each size portrait-first the way KiCad's own docs
    do)."""
    match = PAPER_RE.search(sch_text)
    if not match:
        return DEFAULT_PAGE_SIZE_MM

    name, rest = match.group(1), match.group(2)
    if name == "User":
        nums = re.findall(r"[\d.]+", rest)
        if len(nums) == 2:
            return (float(nums[0]), float(nums[1]))
        return DEFAULT_PAGE_SIZE_MM

    size = STANDARD_PAPER_SIZES_MM.get(name)
    if size is None:
        return DEFAULT_PAGE_SIZE_MM
    portrait_width, portrait_height = size
    if "portrait" in rest:
        return (portrait_width, portrait_height)
    return (portrait_height, portrait_width)


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


_UNSAFE_NODE_CHAR_RE = re.compile(r"[^A-Za-z0-9_]")


def sanitize_spice_node_name(name: str) -> str:
    """KiCad auto-names any net with no explicit label "Net-(REF-PIN)", and a
    real board is free to use a net label like "+VE" -- both common on a
    real, professionally-routed board where nets are largely unlabeled or
    labeled by a different designer's own convention (unlike this project's
    own hand-authored devices, which always hand-pick a clean alnum label).
    Two independent things in this app's pipeline choke on that:

    - ngspice's own tokenizer treats a bare "(" as the start of a
      controlled-source node-group and silently miscounts the rest of the
      line, breaking a raw "Net-(D1-A)" node. kicad-cli's own SPICE netlist
      exporter hit the same problem for the same reason and also substitutes
      "_" for the parens (confirmed against its output for a real imported
      board) -- this sanitizes more aggressively than that (every character
      outside [A-Za-z0-9_], not just parens), so the two won't always agree
      character-for-character on a given net name.
    - spice_runner.py's own op-voltage parser (NODE_VOLTAGE_RE) requires a
      node name to start with a letter or underscore, so a raw "+VE" node's
      voltage is silently never captured (not a parse error -- the line is
      just skipped, so /measure would report 0V for a real, live node).

    Sanitizing every character outside [A-Za-z0-9_] here covers both, plus
    whatever other punctuation the next real board's own net labels use --
    not just the two cases actually hit so far. "0" is passed through as-is:
    it's ngspice's own universal ground node (already the result of this
    same caller's GND -> "0" mapping), not a name that starts with a digit
    by accident."""
    if name == "0":
        return name
    name = _UNSAFE_NODE_CHAR_RE.sub("_", name)
    if name and name[0].isdigit():
        name = f"N_{name}"
    return name


def resolve_all_pin_nets(netlist_xml: str) -> dict[tuple[str, str], str]:
    """(ref, pin_number) -> net name, for every pin in the design. Normalizes
    KiCad's conventions to match circuit.cir's SPICE node names: a leading
    "/" (KiCad's sheet-path prefix for local labels) is stripped, the
    power-symbol net "GND" is mapped to ngspice's ground node "0", and any
    character unsafe in a raw SPICE node name is sanitized (see
    sanitize_spice_node_name) -- all universal SPICE/KiCad conventions, not
    per-device net names."""
    root = ET.fromstring(netlist_xml)
    result: dict[tuple[str, str], str] = {}
    nets = root.find("nets")
    if nets is None:
        return result
    for net in nets:
        name = net.get("name", "").lstrip("/")
        if name == "GND":
            name = "0"
        name = sanitize_spice_node_name(name)
        for node in net:
            result[(node.get("ref", ""), node.get("pin", ""))] = name
    return result


def _iter_paren_blocks(text: str, tag: str):
    """Yield each balanced '(tag ...)' block found in text, at whatever
    nesting depth it first appears -- once a block is matched, the scan
    resumes just past its closing paren, so anything nested *inside* it
    (e.g. a symbol's own sub-unit blocks) is never yielded separately."""
    marker = f"({tag}"
    i = 0
    while True:
        idx = text.find(marker, i)
        if idx == -1:
            return
        after = idx + len(marker)
        if after < len(text) and text[after] not in " \t\n)":
            i = idx + 1  # e.g. "(pin_numbers" must not match tag "pin"
            continue
        depth, j = 0, idx
        while True:
            if text[j] == "(":
                depth += 1
            elif text[j] == ")":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        yield text[idx : j + 1]
        i = j + 1


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


def parse_lib_pin_offsets(sch_text: str) -> dict[str, dict[str, Point]]:
    """lib_id -> {pin_number: (dx, dy)} at rotation 0, read from the
    schematic's own embedded lib_symbols cache (not a system library file --
    this is what makes it work for any symbol type without hardcoding a
    per-type geometry table). Only rotation 0 is implemented for the
    *instance* transform (see parse_all_symbol_instances); every FaultFinder
    device places every symbol unrotated, so this is untested/unverified for
    a rotated instance, not merely "assumed fine"."""
    lib_symbols_match = next(_iter_paren_blocks(sch_text, "lib_symbols"), None)
    if lib_symbols_match is None:
        return {}

    result: dict[str, dict[str, Point]] = {}
    for block in _iter_paren_blocks(lib_symbols_match, "symbol"):
        id_match = re.match(r'\(symbol "([^"]+)"', block)
        if not id_match or ":" not in id_match.group(1):
            continue  # skip nested unit/style sub-symbols (e.g. "R_0_1"), which never carry a library prefix
        pins: dict[str, Point] = {}
        for pin_block in _iter_paren_blocks(block, "pin"):
            at_match = re.search(r"\(at ([-\d.]+) ([-\d.]+)", pin_block)
            num_match = re.search(r'\(number "([^"]+)"', pin_block)
            if at_match and num_match:
                pins[num_match.group(1)] = (float(at_match.group(1)), float(at_match.group(2)))
        if pins:
            result[id_match.group(1)] = pins
    return result


def parse_all_symbol_instances(sch_text: str) -> list[dict]:
    """Every placed symbol instance (ref, lib_id, x, y, rotation) -- this is
    parse_symbol_placements generalized from TP-only to every component."""
    instances = []
    for block in _top_level_blocks(sch_text):
        if not block.startswith("(symbol") or "(lib_id" not in block:
            continue
        lib_match = re.search(r'\(lib_id "([^"]+)"\)', block)
        ref_match = REFERENCE_RE.search(block)
        at_match = AT_RE.search(block)
        if not (lib_match and ref_match and at_match):
            continue
        instances.append({
            "ref": ref_match.group(1),
            "lib_id": lib_match.group(1),
            "x": float(at_match.group(1)),
            "y": float(at_match.group(2)),
            "rotation": float(at_match.group(3)),
        })
    return instances


def _rotate(dx: float, dy: float, angle_deg: float) -> Point:
    angle = round(angle_deg) % 360
    if angle == 90:
        return -dy, dx
    if angle == 180:
        return -dx, -dy
    if angle == 270:
        return dy, -dx
    return dx, dy  # 0, or an unsupported angle -- see parse_lib_pin_offsets


def parse_wires(sch_text: str) -> list[tuple[Point, Point]]:
    wires = []
    for block in _iter_paren_blocks(sch_text, "wire"):
        pts = re.findall(r"\(xy ([-\d.]+) ([-\d.]+)\)", block)
        if len(pts) == 2:
            (x1, y1), (x2, y2) = pts
            wires.append(((float(x1), float(y1)), (float(x2), float(y2))))
    return wires


class _UnionFind:
    def __init__(self):
        self.parent: dict[Point, Point] = {}

    def find(self, x: Point) -> Point:
        self.parent.setdefault(x, x)
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: Point, b: Point):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[ra] = rb


def resolve_wire_nets(wires: list[tuple[Point, Point]], pin_positions: dict[Point, str]) -> list[dict]:
    """Groups wire segments into connected regions (sharing endpoints) and
    labels each with the net name of whichever pin sits at one of its
    points -- exact-coordinate matching, not proximity."""
    uf = _UnionFind()
    for p1, p2 in wires:
        uf.union(p1, p2)

    net_by_root: dict[Point, str] = {}
    for pos, net in pin_positions.items():
        net_by_root[uf.find(pos)] = net

    segments = []
    for p1, p2 in wires:
        net = net_by_root.get(uf.find(p1))
        if net is not None:
            segments.append({"node": net, "x1_mm": p1[0], "y1_mm": p1[1], "x2_mm": p2[0], "y2_mm": p2[1]})
    return segments


def import_probe_geometry(device_id: str) -> dict:
    """Returns every pin (ref, pin number, node, x/y) and every wire segment
    (node, endpoints) in the device's schematic -- the full set of places a
    probe can land, not just TP-prefixed refs -- plus the schematic's own
    page size in mm (see parse_page_size_mm), which the frontend overlay
    needs to convert those mm coordinates to pixels correctly."""
    sch_path = devices.device_dir(device_id) / f"{device_id}.kicad_sch"
    netlist_xml = export_netlist_xml(sch_path)
    sch_text = sch_path.read_text()

    pin_nets = resolve_all_pin_nets(netlist_xml)
    lib_pin_offsets = parse_lib_pin_offsets(sch_text)
    instances = parse_all_symbol_instances(sch_text)

    pins = []
    pin_positions: dict[Point, str] = {}
    for inst in instances:
        offsets = lib_pin_offsets.get(inst["lib_id"], {})
        for pin_num, (dx, dy) in offsets.items():
            net = pin_nets.get((inst["ref"], pin_num))
            if net is None:
                continue
            rdx, rdy = _rotate(dx, dy, inst["rotation"])
            x, y = inst["x"] + rdx, inst["y"] + rdy
            pins.append({"ref": inst["ref"], "pin": pin_num, "node": net, "x_mm": x, "y_mm": y})
            pin_positions[(x, y)] = net

    wire_segments = resolve_wire_nets(parse_wires(sch_text), pin_positions)
    page_width_mm, page_height_mm = parse_page_size_mm(sch_text)

    return {"pins": pins, "wires": wire_segments, "page_width_mm": page_width_mm, "page_height_mm": page_height_mm}
