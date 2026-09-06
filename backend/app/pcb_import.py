"""Backend-side orchestration for the PCB import step (milestone 5).

The actual placement logic needs `pcbnew`, which is only importable from the
*system* python3 (not this project's venv -- see scripts/build_pcb.py's
docstring), so this module shells out to it exactly like kicad_import.py
shells out to kicad-cli. Same reasoning as CLAUDE.md's "do not add a
SPICE-wrapper dependency": don't fight the tool, shell out to it.
"""
import json
import os
import subprocess
import tempfile
from pathlib import Path

from . import devices

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "build_pcb.py"
REAL_PCB_SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "import_real_pcb.py"
KICAD_3DMODEL_DIR = "/usr/share/kicad/3dmodels"


class PcbImportError(Exception):
    pass


def import_pcb(device_id: str) -> dict:
    """Builds <device>.kicad_pcb and pcb.glb in the device's dir, and returns
    the pad-position/board manifest.

    A "real-world imported device" (see CLAUDE.md) ships its own real,
    professionally-routed .kicad_pcb and a NOTICE.md recording where it came
    from -- that NOTICE.md's presence is what selects import_real_pcb.py
    (re-anchor + read the real board as-is) instead of build_pcb.py
    (auto-place a *new* board from the schematic, which would throw away the
    real routing that's the entire point of importing this board)."""
    device_dir = devices.device_dir(device_id)
    sch_path = device_dir / f"{device_id}.kicad_sch"
    out_pcb_path = device_dir / f"{device_id}.kicad_pcb"
    is_real_pcb_device = (device_dir / "NOTICE.md").is_file()

    with tempfile.TemporaryDirectory() as tmp:
        manifest_path = Path(tmp) / "manifest.json"
        if is_real_pcb_device:
            args = ["python3", str(REAL_PCB_SCRIPT_PATH), str(out_pcb_path), str(manifest_path)]
        else:
            args = ["python3", str(SCRIPT_PATH), str(sch_path), str(out_pcb_path), str(manifest_path)]
        result = subprocess.run(args, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            raise PcbImportError(result.stderr or result.stdout)
        manifest = json.loads(manifest_path.read_text())

    glb_path = device_dir / "pcb.glb"
    env = {**os.environ, "KICAD9_3DMODEL_DIR": KICAD_3DMODEL_DIR}
    glb_flags = ["--include-pads", "--include-silkscreen", "--include-soldermask", "--include-tracks"]
    if is_real_pcb_device:
        # A real board's ground net is commonly a filled copper zone/pour
        # rather than discrete traces (true for bridge_rectifier_06) -- without
        # this flag that net renders with no visible copper at all, even
        # though every hand-authored device (which never creates a zone) is
        # rendered correctly without it.
        glb_flags.append("--include-zones")
    result = subprocess.run(
        # Off by default -- without --include-pads/silkscreen/soldermask the
        # board renders as a bare green slab plus component bodies, with no
        # pads, TP silkscreen labels, or copper visible at all, even though
        # all three exist in the .kicad_pcb (confirmed by re-exporting one
        # device with these flags and comparing the rendered result before
        # adding this generically for every device). build_pcb.py draws real
        # point-to-point copper between same-net pads (see its own
        # docstring), hence --include-tracks for hand-authored devices too.
        ["kicad-cli", "pcb", "export", "glb", str(out_pcb_path), "-o", str(glb_path), *glb_flags],
        capture_output=True, text=True, timeout=60, env=env,
    )
    if result.returncode != 0:
        raise PcbImportError(result.stderr or result.stdout)

    return manifest
