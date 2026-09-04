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
KICAD_3DMODEL_DIR = "/usr/share/kicad/3dmodels"


class PcbImportError(Exception):
    pass


def import_pcb(device_id: str) -> dict:
    """Builds <device>.kicad_pcb and pcb.glb in the device's dir, and returns
    the pad-position/board manifest from build_pcb.py."""
    device_dir = devices.device_dir(device_id)
    sch_path = device_dir / f"{device_id}.kicad_sch"
    out_pcb_path = device_dir / f"{device_id}.kicad_pcb"

    with tempfile.TemporaryDirectory() as tmp:
        manifest_path = Path(tmp) / "manifest.json"
        result = subprocess.run(
            ["python3", str(SCRIPT_PATH), str(sch_path), str(out_pcb_path), str(manifest_path)],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            raise PcbImportError(result.stderr or result.stdout)
        manifest = json.loads(manifest_path.read_text())

    glb_path = device_dir / "pcb.glb"
    env = {**os.environ, "KICAD9_3DMODEL_DIR": KICAD_3DMODEL_DIR}
    result = subprocess.run(
        ["kicad-cli", "pcb", "export", "glb", str(out_pcb_path), "-o", str(glb_path)],
        capture_output=True, text=True, timeout=60, env=env,
    )
    if result.returncode != 0:
        raise PcbImportError(result.stderr or result.stdout)

    return manifest
