import shutil
import subprocess

import pytest

from app import devices, pcb_import


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


@requires_kicad
@requires_pcbnew
def test_import_pcb_writes_kicad_pcb_and_glb_and_returns_testpoint_pads():
    manifest = pcb_import.import_pcb("voltage_divider_01")

    device_dir = devices.device_dir("voltage_divider_01")
    assert (device_dir / "voltage_divider_01.kicad_pcb").exists()
    assert (device_dir / "pcb.glb").exists()

    assert set(manifest["pads"].keys()) == {"TP1", "TP2", "TP3"}
    assert manifest["board_size_mm"]["width"] > 0
    assert manifest["board_size_mm"]["height"] > 0


def test_import_pcb_unknown_device_raises():
    with pytest.raises(devices.DeviceNotFound):
        pcb_import.import_pcb("nope")
