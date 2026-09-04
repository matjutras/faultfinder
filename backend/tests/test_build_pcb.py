import json
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
])
def test_build_pcb_places_every_testpoint_for_all_three_devices(device_id, tp_ids, tmp_path):
    """The generalization check for the PCB pipeline, mirroring milestone 4's
    schematic-side one: this must work for every device through the same
    script, with zero device-specific code."""
    manifest = _run_build_pcb(device_id, tmp_path)

    assert set(manifest["pads"].keys()) == set(tp_ids)
    for tp_id in tp_ids:
        pad = manifest["pads"][tp_id]
        assert 0 <= pad["x_mm"] <= manifest["board_size_mm"]["width"]
        assert 0 <= pad["y_mm"] <= manifest["board_size_mm"]["height"]
    assert manifest["board_thickness_mm"] > 0


@requires_kicad
@requires_pcbnew
def test_build_pcb_skips_spice_only_simulation_symbols(tmp_path):
    manifest = _run_build_pcb("voltage_divider_01", tmp_path)
    # V1 is a Simulation_SPICE VDC source, not a real PCB part -- must not
    # produce a pad entry (it isn't a TP either, so this also guards against
    # accidentally treating it as one).
    assert "V1" not in manifest["pads"]
