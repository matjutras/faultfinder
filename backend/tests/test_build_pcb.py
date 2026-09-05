import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "build_pcb.py"
DEVICES_ROOT = Path(__file__).resolve().parents[2] / "devices"


def _pcbnew_available() -> bool:
    return subprocess.run(
        ["python3", "-c", "import pcbnew"], capture_output=True
    ).returncode == 0


requires_kicad = pytest.mark.skipif(
    shutil.which("kicad-cli") is None, reason="kicad-cli not installed"
)
requires_pcbnew = pytest.mark.skipif(
    not _pcbnew_available(), reason="system python3 has no pcbnew module"
)


def _run_build_pcb(device_id: str, tmp_path: Path) -> dict:
    sch_path = DEVICES_ROOT / device_id / f"{device_id}.kicad_sch"
    out_pcb = tmp_path / f"{device_id}.kicad_pcb"
    manifest_path = tmp_path / "manifest.json"
    result = subprocess.run(
        ["python3", str(SCRIPT), str(sch_path), str(out_pcb), str(manifest_path)],
        capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stderr
    assert out_pcb.exists()
    return json.loads(manifest_path.read_text())


@requires_kicad
@requires_pcbnew
@pytest.mark.parametrize("device_id,tp_ids", [
    ("voltage_divider_01", ["TP1", "TP2", "TP3"]),
    ("resistor_ladder_02", ["TP1", "TP2", "TP3", "TP4"]),
    ("diode_indicator_03", ["TP1", "TP2", "TP3"]),
    ("transistor_switch_04", ["TP1", "TP2", "TP3", "TP4"]),
    ("resistor_bridge_05", ["TP1", "TP2", "TP3", "TP4"]),
])
def test_build_pcb_places_every_testpoint_for_all_devices(device_id, tp_ids, tmp_path):
    """The generalization check for the PCB pipeline, mirroring milestone 4's
    schematic-side one: this must work for every device through the same
    script, with zero device-specific code."""
    manifest = _run_build_pcb(device_id, tmp_path)

    tp_refs = {p["ref"] for p in manifest["pads"] if p["ref"].startswith("TP")}
    assert tp_refs == set(tp_ids)
    for pad in manifest["pads"]:
        if pad["ref"] not in tp_ids:
            continue
        assert 0 <= pad["x_mm"] <= manifest["board_size_mm"]["width"]
        assert 0 <= pad["y_mm"] <= manifest["board_size_mm"]["height"]
    assert manifest["board_thickness_mm"] > 0


@requires_kicad
@requires_pcbnew
def test_build_pcb_manifest_has_a_pad_for_every_component_pin_not_just_tp(tmp_path):
    """Milestone 8 (probe anywhere): every pin of every component is a real
    probe point now, not just TP-ref pads."""
    manifest = _run_build_pcb("voltage_divider_01", tmp_path)
    refs = {p["ref"] for p in manifest["pads"]}
    assert refs == {"R1", "R2", "TP1", "TP2", "TP3"}  # V1 excluded -- see the SPICE-only test below
    r1_pins = {p["pin"] for p in manifest["pads"] if p["ref"] == "R1"}
    assert r1_pins == {"1", "2"}


def _orient(a, b, c):
    val = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    if abs(val) < 1e-6:
        return 0
    return 1 if val > 0 else -1


def _on_segment(a, b, c):
    return (min(a[0], b[0]) - 1e-6 <= c[0] <= max(a[0], b[0]) + 1e-6
            and min(a[1], b[1]) - 1e-6 <= c[1] <= max(a[1], b[1]) + 1e-6)


def _segments_intersect(p1, p2, p3, p4):
    if {p1, p2} & {p3, p4}:
        return False
    o1, o2, o3, o4 = _orient(p1, p2, p3), _orient(p1, p2, p4), _orient(p3, p4, p1), _orient(p3, p4, p2)
    if o1 != o2 and o3 != o4:
        return True
    return ((o1 == 0 and _on_segment(p1, p2, p3)) or (o2 == 0 and _on_segment(p1, p2, p4))
            or (o3 == 0 and _on_segment(p3, p4, p1)) or (o4 == 0 and _on_segment(p3, p4, p2)))


_SEGMENT_RE = re.compile(
    r'\(segment\s*\(start ([-\d.]+) ([-\d.]+)\)\s*\(end ([-\d.]+) ([-\d.]+)\)\s*'
    r'\(width [\d.]+\)\s*\(layer "([^"]+)"\)\s*\(net (\d+)\)'
)


@requires_kicad
@requires_pcbnew
@pytest.mark.parametrize("device_id", [
    "voltage_divider_01", "resistor_ladder_02", "diode_indicator_03",
    "transistor_switch_04", "resistor_bridge_05",
])
def test_build_pcb_has_no_same_layer_cross_net_track_crossings(device_id, tmp_path):
    """Regression test: the first routing pass connected same-net pads with a
    straight line regardless of what else was in the way -- real, DRC-invalid
    crossings on the same copper layer (even voltage_divider_01, a 2-resistor
    device, had 3 of them among just 4 segments). Parses the actual emitted
    segment geometry from the real .kicad_pcb output, not the manifest, since
    that's the only place a routing regression would actually show up."""
    _run_build_pcb(device_id, tmp_path)
    pcb_text = (tmp_path / f"{device_id}.kicad_pcb").read_text()

    segments = [
        ((float(x1), float(y1)), (float(x2), float(y2)), layer, net)
        for x1, y1, x2, y2, layer, net in _SEGMENT_RE.findall(pcb_text)
    ]
    assert len(segments) > 0

    crossings = [
        (segments[i], segments[j])
        for i in range(len(segments))
        for j in range(i + 1, len(segments))
        if segments[i][3] != segments[j][3]  # different nets
        and segments[i][2] == segments[j][2]  # same layer
        and _segments_intersect(segments[i][0], segments[i][1], segments[j][0], segments[j][1])
    ]
    assert crossings == []


@requires_kicad
@requires_pcbnew
def test_build_pcb_skips_spice_only_simulation_symbols(tmp_path):
    manifest = _run_build_pcb("voltage_divider_01", tmp_path)
    # V1 is a Simulation_SPICE VDC source, not a real PCB part -- must not
    # produce a pad entry.
    assert not any(p["ref"] == "V1" for p in manifest["pads"])
