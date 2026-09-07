"""Permanent, automated guard against pcb_import.py regressing back to the
fuzz_pedal_11 bug (see CLAUDE.md's Known gotchas): kicad-cli's glb export has
no size/triangle budget of its own, and a future real-world import (the
audio amp work already in progress, or anything denser than fuzz_pedal_11's
73 components) could just as easily produce another multi-megabyte,
hundreds-of-thousands-of-triangles glb if `_optimize_glb` ever stops running
or stops being effective. Parses the GLB container directly (stdlib
json/struct only -- no new backend dependency for a test-only check) rather
than requiring a full gltf library, since a GLB's structure is simple: a
12-byte header, then a length-prefixed JSON chunk holding every mesh's
accessor references.

Every existing device is comfortably under these thresholds after
`_optimize_glb` (worst case, fuzz_pedal_11, is ~540KB / ~91k triangles --
see the module docstring's own numbers). The ceilings below leave real
headroom (~4x) above that for a genuinely more complex future board, while
still catching a regression back to multi-megabyte/300k+-triangle territory."""
import json
import struct

from app import devices

MAX_GLB_BYTES = 2 * 1024 * 1024
MAX_TRIANGLES = 150_000


def _glb_triangle_count(path) -> int:
    data = path.read_bytes()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF", f"{path} is not a valid GLB (bad magic)"
    chunk_len, chunk_type = struct.unpack_from("<II", data, 12)
    doc = json.loads(data[20:20 + chunk_len])
    accessors = doc.get("accessors", [])
    tris = 0
    for mesh in doc.get("meshes", []):
        for prim in mesh.get("primitives", []):
            if "indices" in prim:
                tris += accessors[prim["indices"]]["count"] // 3
            else:
                tris += accessors[prim["attributes"]["POSITION"]]["count"] // 3
    return tris


def test_every_devices_glb_stays_within_the_size_and_triangle_budget():
    glb_paths = sorted(devices.DEVICES_ROOT.glob("*/pcb.glb"))
    assert glb_paths, "no device has a pcb.glb -- run the PCB importer first"

    failures = []
    for path in glb_paths:
        device_id = path.parent.name
        size = path.stat().st_size
        tris = _glb_triangle_count(path)
        if size > MAX_GLB_BYTES or tris > MAX_TRIANGLES:
            failures.append(f"{device_id}: {size / 1024:.0f}KB, {tris} triangles")

    assert not failures, (
        "device(s) exceed the glb size/triangle budget (see this file's own "
        "docstring) -- either _optimize_glb regressed/isn't running, or this "
        f"device's own board is genuinely denser and the budget needs "
        f"raising deliberately, not silently: {failures}"
    )
