import json
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
requires_node = pytest.mark.skipif(
    shutil.which("npx") is None, reason="npx not installed (needed by pcb_import._optimize_glb)"
)


@requires_kicad
@requires_pcbnew
@requires_node
def test_import_pcb_writes_kicad_pcb_and_glb_and_returns_every_pad():
    manifest = pcb_import.import_pcb("voltage_divider_01")

    device_dir = devices.device_dir("voltage_divider_01")
    assert (device_dir / "voltage_divider_01.kicad_pcb").exists()
    assert (device_dir / "pcb.glb").exists()

    tp_refs = {p["ref"] for p in manifest["pads"] if p["ref"].startswith("TP")}
    assert tp_refs == {"TP1", "TP2", "TP3"}
    assert manifest["board_size_mm"]["width"] > 0
    assert manifest["board_size_mm"]["height"] > 0


@requires_kicad
@requires_pcbnew
def test_import_real_pcb_excludes_off_board_mechanical_footprints_from_glb_source(tmp_path):
    # fuzz_pedal_11's real source places 5 mechanical/enclosure-context
    # footprints (a DC barrel jack, two 6.35mm audio jacks, a panel
    # footswitch, a toggle switch) physically outside its own Edge_Cuts
    # outline -- a normal KiCad convention for off-board panel hardware, not
    # an import bug (see CLAUDE.md's Known gotchas: without this filter they
    # render as components floating in space, disconnected from the actual
    # board). Confirms the glb-source copy drops exactly those, while the
    # real board (read for the pad/track manifest) is untouched.
    real_pcb = devices.device_dir("fuzz_pedal_11") / "fuzz_pedal_11.kicad_pcb"
    pcb_copy = tmp_path / "fuzz_pedal_11.kicad_pcb"
    pcb_copy.write_text(real_pcb.read_text())
    manifest_path = tmp_path / "manifest.json"
    glb_source_path = tmp_path / "glb-source.kicad_pcb"

    result = subprocess.run(
        ["python3", str(pcb_import.REAL_PCB_SCRIPT_PATH), str(pcb_copy), str(manifest_path), str(glb_source_path)],
        capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stderr
    manifest = json.loads(manifest_path.read_text())
    assert manifest["pads"], "the real manifest should still reflect the full, unfiltered board"

    def _footprint_count(pcb_path: Path) -> int:
        r = subprocess.run(
            ["python3", "-c",
             f"import pcbnew; b = pcbnew.LoadBoard({str(pcb_path)!r}); print(len(list(b.GetFootprints())))"],
            capture_output=True, text=True, timeout=30,
        )
        assert r.returncode == 0, r.stderr
        return int(r.stdout.strip())

    real_count = _footprint_count(pcb_copy)
    filtered_count = _footprint_count(glb_source_path)
    assert real_count - filtered_count == 5, (
        f"expected exactly 5 off-board mechanical footprints excluded from the "
        f"glb-source copy, got {real_count - filtered_count} (real={real_count}, "
        f"filtered={filtered_count})"
    )


def test_import_pcb_unknown_device_raises():
    with pytest.raises(devices.DeviceNotFound):
        pcb_import.import_pcb("nope")


@pytest.fixture
def _preserve_bridge_rectifier_glb():
    # The mocked tests below write straight to bridge_rectifier_06's real,
    # on-disk pcb.glb (pcb_import.import_pcb hardcodes device_dir / "pcb.glb",
    # not overridable to a tmp_path) to exercise import_pcb()'s own file-
    # existence/size checks -- restore whatever was really there before (or
    # remove it, if there wasn't one), so a full test run doesn't leave this
    # committed device's generated glb corrupted/deleted for anything that
    # runs afterward (e.g. test_pcb_glb_budget.py's size/triangle check).
    glb_path = devices.device_dir("bridge_rectifier_06") / "pcb.glb"
    original = glb_path.read_bytes() if glb_path.is_file() else None
    yield
    if original is None:
        glb_path.unlink(missing_ok=True)
    else:
        glb_path.write_bytes(original)


def _fake_real_pcb_import_run(args):
    # Mimics import_real_pcb.py's __main__: (pcb_path, manifest_path,
    # glb_source_path) -- see pcb_import.py's own call for the real arg
    # order. glb_source_path just needs to exist; kicad-cli never actually
    # reads it in these mocked tests.
    manifest_path, glb_source_path = Path(args[-2]), Path(args[-1])
    glb_source_path.write_text("(kicad_pcb (fake))")
    manifest_path.write_text(json.dumps({
        "pads": [], "tracks": [], "board_size_mm": {"width": 1, "height": 1},
        "board_thickness_mm": 1.6, "glb_source_pcb": str(glb_source_path),
    }))
    return SimpleNamespace(returncode=0, stdout="", stderr="")


def test_import_pcb_tolerates_a_nonzero_glb_exit_code_if_a_glb_was_still_written(monkeypatch, _preserve_bridge_rectifier_glb):
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
            return _fake_real_pcb_import_run(args)
        elif args[0] == "kicad-cli":
            glb_path = Path(args[args.index("-o") + 1])
            glb_path.write_bytes(b"not a real glb but non-empty")
            return SimpleNamespace(returncode=2, stdout="Binary GLTF file created.\n", stderr="No model for filename ...\n")
        else:
            # gltf-transform optimize (see pcb_import._optimize_glb): mocked
            # as a no-op pass-through, same non-empty-output success signal.
            out_path = Path(args[-3])
            out_path.write_bytes(b"optimized glb (fake, non-empty)")
            return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    manifest = pcb_import.import_pcb("bridge_rectifier_06")

    assert manifest["pads"] == []
    glb_calls = [c for c in calls if c[0] == "kicad-cli"]
    assert len(glb_calls) == 1


def test_import_pcb_raises_if_glb_export_produces_no_file(monkeypatch, _preserve_bridge_rectifier_glb):
    # The genuinely fatal case (a real kicad-cli crash, a bad .kicad_pcb):
    # no output file at all, which must still raise. Clears any glb already
    # on disk from a real prior import first, so this device's success
    # criterion (a written, non-empty glb) genuinely isn't met here.
    (devices.device_dir("bridge_rectifier_06") / "pcb.glb").unlink(missing_ok=True)

    def fake_run(args, **kwargs):
        if args[0] == "python3":
            return _fake_real_pcb_import_run(args)
        else:
            return SimpleNamespace(returncode=1, stdout="", stderr="kicad-cli: fatal error")

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(pcb_import.PcbImportError, match="fatal error"):
        pcb_import.import_pcb("bridge_rectifier_06")


def test_import_pcb_raises_if_glb_optimize_produces_no_file(monkeypatch, _preserve_bridge_rectifier_glb):
    # Same reasoning as the kicad-cli file-check: a genuinely fatal
    # gltf-transform failure (bad npx install, a real crash) must still
    # raise rather than silently ship the huge unoptimized glb.
    def fake_run(args, **kwargs):
        if args[0] == "python3":
            return _fake_real_pcb_import_run(args)
        elif args[0] == "kicad-cli":
            glb_path = Path(args[args.index("-o") + 1])
            glb_path.write_bytes(b"a real, valid glb (fake but non-empty)")
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        else:
            return SimpleNamespace(returncode=1, stdout="", stderr="npx: command not found")

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(pcb_import.PcbImportError, match="npx"):
        pcb_import.import_pcb("bridge_rectifier_06")
