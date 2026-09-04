import json

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import devices, kicad_import, netlist, spice_runner

app = FastAPI(title="FaultFinder API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://192.168.0.185:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static/devices", StaticFiles(directory=devices.DEVICES_ROOT), name="device-assets")


class MeasureRequest(BaseModel):
    tp_ids: list[str]
    fault_id: str = "healthy"


@app.get("/api/devices/{device_id}")
def get_device(device_id: str):
    try:
        device = devices.load_device(device_id)
        device["testpoints"] = devices.load_map(device_id)["testpoints"]
        device["faults"] = devices.load_faults(device_id)
        return device
    except devices.DeviceNotFound:
        raise HTTPException(status_code=404, detail="device not found")


@app.post("/api/devices/{device_id}/import")
def import_device(device_id: str):
    try:
        testpoints = kicad_import.import_testpoints(device_id)
    except devices.DeviceNotFound:
        raise HTTPException(status_code=404, detail="device not found")
    except kicad_import.KicadCliError as e:
        raise HTTPException(status_code=502, detail=f"kicad-cli failed: {e}")

    map_path = devices.device_dir(device_id) / "map.json"
    map_path.write_text(json.dumps({"id": device_id, "testpoints": testpoints}, indent=2) + "\n")
    return {"testpoints": testpoints}


@app.post("/api/devices/{device_id}/measure")
def measure(device_id: str, req: MeasureRequest):
    if len(req.tp_ids) != 2:
        raise HTTPException(status_code=400, detail="place exactly 2 probes")

    try:
        fault = devices.find_fault(device_id, req.fault_id)
        circuit = devices.load_circuit(device_id)
        testpoints = {tp["tp_id"]: tp for tp in devices.load_map(device_id)["testpoints"]}
        for tp_id in req.tp_ids:
            if tp_id not in testpoints:
                raise HTTPException(status_code=400, detail=f"unknown test point {tp_id!r}")
    except devices.DeviceNotFound:
        raise HTTPException(status_code=404, detail="device not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    patched = netlist.apply_patch(circuit, fault["patch"])

    try:
        node_voltages = spice_runner.simulate(patched)
    except spice_runner.NgspiceError as e:
        raise HTTPException(status_code=502, detail=f"ngspice failed: {e}")

    probe_a, probe_b = (testpoints[tp_id] for tp_id in req.tp_ids)
    v_a = node_voltages.get(probe_a["node"].upper(), 0.0)
    v_b = node_voltages.get(probe_b["node"].upper(), 0.0)

    return {
        "fault_id": fault["id"],
        "probes": {probe_a["tp_id"]: v_a, probe_b["tp_id"]: v_b},
        "differential_volts": v_a - v_b,
    }
