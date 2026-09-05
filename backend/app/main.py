import json
import random

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import devices, fault_gen, kicad_import, netlist, pcb_import, spice_runner

HEALTHY_FAULT = {"id": "healthy", "name": "No fault", "difficulty": "n/a", "patch": []}

app = FastAPI(title="FaultFinder API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://192.168.0.185:5173",
        "https://apps.matjutras.com",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static/devices", StaticFiles(directory=devices.DEVICES_ROOT), name="device-assets")


class MeasureRequest(BaseModel):
    nodes: list[str]  # exactly 2 SPICE node names -- whatever pin/pad/wire/track point the user probed
    fault_id: str = "healthy"


@app.get("/api/devices")
def list_devices():
    return devices.list_devices()


@app.get("/api/devices/{device_id}")
def get_device(device_id: str):
    try:
        device = devices.load_device(device_id)
        device_map = devices.load_map(device_id)
        device["pins"] = device_map["pins"]
        device["wires"] = device_map["wires"]
        device["pcb_pads"] = device_map.get("pcb_pads", [])
        device["pcb_tracks"] = device_map.get("pcb_tracks", [])
        device["faults"] = devices.load_faults(device_id)
        device["board_size_mm"] = device_map.get("board_size_mm")
        device["board_thickness_mm"] = device_map.get("board_thickness_mm")
        device["pcb_glb"] = "pcb.glb" if device_map.get("board_size_mm") else None
        return device
    except devices.DeviceNotFound:
        raise HTTPException(status_code=404, detail="device not found")


@app.post("/api/devices/{device_id}/import")
def import_device(device_id: str):
    try:
        geometry = kicad_import.import_probe_geometry(device_id)
    except devices.DeviceNotFound:
        raise HTTPException(status_code=404, detail="device not found")
    except kicad_import.KicadCliError as e:
        raise HTTPException(status_code=502, detail=f"kicad-cli failed: {e}")

    try:
        pcb_manifest = pcb_import.import_pcb(device_id)
    except pcb_import.PcbImportError as e:
        raise HTTPException(status_code=502, detail=f"PCB import failed: {e}")

    map_path = devices.device_dir(device_id) / "map.json"
    map_path.write_text(json.dumps({
        "id": device_id,
        "pins": geometry["pins"],
        "wires": geometry["wires"],
        "pcb_pads": pcb_manifest["pads"],
        "pcb_tracks": pcb_manifest["tracks"],
        "board_size_mm": pcb_manifest["board_size_mm"],
        "board_thickness_mm": pcb_manifest["board_thickness_mm"],
    }, indent=2) + "\n")

    circuit = devices.load_circuit(device_id)
    faults = [HEALTHY_FAULT] + fault_gen.generate_fault_pool(circuit)
    faults_path = devices.device_dir(device_id) / "faults.json"
    faults_path.write_text(json.dumps(faults, indent=2) + "\n")

    return {"pins": geometry["pins"], "wires": geometry["wires"], "faults": faults}


@app.post("/api/devices/{device_id}/measure")
def measure(device_id: str, req: MeasureRequest):
    if len(req.nodes) != 2:
        raise HTTPException(status_code=400, detail="place exactly 2 probes")

    try:
        fault = devices.find_fault(device_id, req.fault_id)
        circuit = devices.load_circuit(device_id)
        valid_nodes = devices.load_valid_nodes(device_id)
        for node in req.nodes:
            if node not in valid_nodes:
                raise HTTPException(status_code=400, detail=f"unknown node {node!r}")
    except devices.DeviceNotFound:
        raise HTTPException(status_code=404, detail="device not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    patch = fault["patch"]
    if fault.get("intermittent") and random.random() < 0.5:
        patch = []  # a "miss": the connection happens to be fine this time
    patched = netlist.apply_patch(circuit, patch)

    try:
        node_voltages = spice_runner.simulate(patched)
    except spice_runner.NgspiceError as e:
        raise HTTPException(status_code=502, detail=f"ngspice failed: {e}")

    node_a, node_b = req.nodes
    v_a = node_voltages.get(node_a.upper(), 0.0)
    v_b = node_voltages.get(node_b.upper(), 0.0)

    return {
        "fault_id": fault["id"],
        "probes": [{"node": node_a, "volts": v_a}, {"node": node_b, "volts": v_b}],
        "differential_volts": v_a - v_b,
    }
