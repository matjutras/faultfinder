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

# Pinned exact version (same reasoning as kicad-cli's own version pinning
# elsewhere in this pipeline -- reproducible output, not whatever `latest`
# happens to resolve to on a given day). Runs via `npx`, which caches this
# exact version after the first run, so it's not a network call on every
# import. See the glb-optimize step below for why this exists at all.
GLTF_TRANSFORM_PKG = "@gltf-transform/cli@4.5.0"


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
            # A separate path, inside this same tempdir so its lifetime
            # matches the glb export below -- see import_real_pcb.py's own
            # comment for why this must not live under devices/.
            glb_source_path = Path(tmp) / "glb-source.kicad_pcb"
            args = [
                "python3", str(REAL_PCB_SCRIPT_PATH), str(out_pcb_path), str(manifest_path),
                str(glb_source_path),
            ]
        else:
            args = ["python3", str(SCRIPT_PATH), str(sch_path), str(out_pcb_path), str(manifest_path)]
        result = subprocess.run(args, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            raise PcbImportError(result.stderr or result.stdout)
        manifest = json.loads(manifest_path.read_text())

        # For a real-world board, export from the off-board-footprint-
        # filtered copy (see import_real_pcb.py), not the real .kicad_pcb --
        # a hand-authored device never has off-board footprints (build_pcb.py
        # only ever places components inside the board it draws), so it
        # exports from the real file directly.
        glb_export_input = Path(manifest["glb_source_pcb"]) if is_real_pcb_device else out_pcb_path

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
            ["kicad-cli", "pcb", "export", "glb", str(glb_export_input), "-o", str(glb_path), *glb_flags],
            capture_output=True, text=True, timeout=60, env=env,
        )
        # kicad-cli's glb exporter returns a nonzero exit code whenever it can't
        # find or parse the 3D model (.wrl/.step) for *any* footprint on the
        # board -- found importing fuzz_pedal_11, whose real 3D model library
        # includes several THT part variants (a DO-35 diode, a TO-92 transistor,
        # 3mm/5mm THT LEDs, a Bourns trimmer pot) that this system's installed
        # KiCad 3D model set can't parse (a real "IrrelevantNumber" VRML-parser
        # error, confirmed by running the exact same kicad-cli command by hand),
        # plus its own custom footprint library referencing a `${CIRCLE_CIRCUITS}`
        # environment variable this system never had reason to set. In every
        # case the exporter still finishes and writes a complete, valid glb --
        # pads, tracks, silkscreen, and zones are unaffected; only the specific
        # footprints with a broken/missing 3D model render without a 3D body.
        # A genuinely fatal failure (a bad .kicad_pcb, a real kicad-cli crash)
        # doesn't produce an output file at all, so that's the actual failure
        # signal to check, not the exit code alone.
        if not (glb_path.is_file() and glb_path.stat().st_size > 0):
            raise PcbImportError(result.stderr or result.stdout)

        _optimize_glb(glb_path)

    return manifest


def _optimize_glb(glb_path: Path) -> None:
    """kicad-cli's glb export ships every component at its full authored 3D-
    model complexity, with no size/triangle budget of its own -- fine for a
    handful of generic passives, but fuzz_pedal_11 (73 real THT components,
    each using KiCad's realistic, high-poly THT library models -- e.g. a
    single axial resistor's stock model is ~3500 triangles) exported an
    11.5MB / ~320k-triangle glb, dramatically larger than every other
    device's (all under 1.7MB), which was directly why its 3D view was slow
    to load and laggy to orbit. `gltf-transform optimize` (meshoptimizer
    under the hood) welds duplicate vertices, GPU-instances repeated meshes
    (e.g. those 20+ identical resistor bodies), simplifies geometry within a
    small error tolerance, and recompresses the result -- cut fuzz_pedal_11
    to ~540KB / ~91k triangles in testing, visually indistinguishable at this
    app's viewing distance (verified via a real Playwright screenshot, not
    assumed). `--simplify-error` (a fraction of mesh extent) is used instead
    of a fixed `--simplify-ratio`: a ratio is a fixed fraction of a device's
    *existing* vertex count, which would over-simplify an already-small,
    already-simple hand-authored device's board just as aggressively as a
    genuinely complex one; an error tolerance instead self-scales to how much
    detail each device's own geometry actually has. This runs for *every*
    device's glb, not just complex real-world imports, since drei's
    `useGLTF` (this app's frontend loader) already wires up a
    `MeshoptDecoder` by default, and the app's own probe-placement raycasting
    (`pcbRaycast.ts`) hits a fixed math plane, never the mesh itself, so mesh
    simplification can't affect probe accuracy.

    Runs via `npx` (no Node dependency baked into the deployed Docker image --
    like kicad-cli/pcbnew, this only runs at *import* time, on a dev machine;
    the deployed image ships the already-generated per-device files, see
    Dockerfile). A failure here is treated as fatal, same reasoning as the
    kicad-cli file-check above: silently keeping the huge unoptimized glb
    would resurface this exact bug on the next device import instead of
    surfacing it immediately."""
    optimized_path = glb_path.with_suffix(".optimized.glb")
    result = subprocess.run(
        [
            "npx", "--yes", GLTF_TRANSFORM_PKG, "optimize",
            str(glb_path), str(optimized_path), "--simplify-error", "0.01",
        ],
        capture_output=True, text=True, timeout=120,
    )
    if not (optimized_path.is_file() and optimized_path.stat().st_size > 0):
        raise PcbImportError(result.stderr or result.stdout)
    optimized_path.replace(glb_path)
