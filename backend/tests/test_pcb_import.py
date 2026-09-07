import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

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
def test_import_pcb_writes_kicad_pcb_and_glb_and_returns_every_pad():
    manifest = pcb_import.import_pcb("voltage_divider_01")

    device_dir = devices.device_dir("voltage_divider_01")
    assert (device_dir / "voltage_divider_01.kicad_pcb").exists()
    assert (device_dir / "pcb.glb").exists()

    tp_refs = {p["ref"] for p in manifest["pads"] if p["ref"].startswith("TP")}
    assert tp_refs == {"TP1", "TP2", "TP3"}
    assert manifest["board_size_mm"]["width"] > 0
    assert manifest["board_size_mm"]["height"] > 0


def test_import_pcb_unknown_device_raises():
    with pytest.raises(devices.DeviceNotFound):
        pcb_import.import_pcb("nope")


def test_import_pcb_tolerates_a_nonzero_glb_exit_code_if_a_glb_was_still_written(monkeypatch):
    # kicad-cli's glb exporter returns a nonzero exit code whenever it can't
    # find/parse a 3D model for *any* footprint, even though it still writes
    # a complete, valid glb (pads/tracks/silkscreen/zones unaffected) --
    # found importing fuzz_pedal_11 (real THT diode/transistor/LED/pot 3D
    # models this system's KiCad install can't parse). The exit code alone
    # is not the right failure signal; a written, non-empty glb file is.
    calls = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args[0] == "python3":
            manifest_path = Path(args[-1])
            manifest_path.write_text('{"pads": [], "tracks": [], "board_size_mm": {"width": 1, "height": 1}, "board_thickness_mm": 1.6}')
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        else:
            glb_path = Path(args[args.index("-o") + 1])
            glb_path.write_bytes(b"not a real glb but non-empty")
            return SimpleNamespace(returncode=2, stdout="Binary GLTF file created.\n", stderr="No model for filename ...\n")

    monkeypatch.setattr(subprocess, "run", fake_run)

    manifest = pcb_import.import_pcb("bridge_rectifier_06")

    assert manifest["pads"] == []
    glb_calls = [c for c in calls if c[0] == "kicad-cli"]
    assert len(glb_calls) == 1


def test_import_pcb_raises_if_glb_export_produces_no_file(monkeypatch):
    # The genuinely fatal case (a real kicad-cli crash, a bad .kicad_pcb):
    # no output file at all, which must still raise. Clears any glb already
    # on disk from a real prior import first, so this device's success
    # criterion (a written, non-empty glb) genuinely isn't met here.
    (devices.device_dir("bridge_rectifier_06") / "pcb.glb").unlink(missing_ok=True)

    def fake_run(args, **kwargs):
        if args[0] == "python3":
            manifest_path = Path(args[-1])
            manifest_path.write_text('{"pads": [], "tracks": [], "board_size_mm": {"width": 1, "height": 1}, "board_thickness_mm": 1.6}')
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        else:
            return SimpleNamespace(returncode=1, stdout="", stderr="kicad-cli: fatal error")

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(pcb_import.PcbImportError, match="fatal error"):
        pcb_import.import_pcb("bridge_rectifier_06")
