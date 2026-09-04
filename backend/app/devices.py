"""Loading per-device files from devices/<device_id>/ (see repo CLAUDE.md for the convention)."""
import json
from pathlib import Path

DEVICES_ROOT = Path(__file__).resolve().parents[2] / "devices"


class DeviceNotFound(Exception):
    pass


def device_dir(device_id: str) -> Path:
    d = DEVICES_ROOT / device_id
    if not d.is_dir():
        raise DeviceNotFound(device_id)
    return d


def load_device(device_id: str) -> dict:
    return json.loads((device_dir(device_id) / "device.json").read_text())


def load_map(device_id: str) -> dict:
    return json.loads((device_dir(device_id) / "map.json").read_text())


def load_faults(device_id: str) -> list[dict]:
    return json.loads((device_dir(device_id) / "faults.json").read_text())


def load_circuit(device_id: str) -> str:
    return (device_dir(device_id) / "circuit.cir").read_text()


def find_fault(device_id: str, fault_id: str) -> dict:
    for fault in load_faults(device_id):
        if fault["id"] == fault_id:
            return fault
    raise ValueError(f"unknown fault_id {fault_id!r} for device {device_id!r}")


def find_testpoint(device_id: str, tp_id: str) -> dict:
    for tp in load_map(device_id)["testpoints"]:
        if tp["tp_id"] == tp_id:
            return tp
    raise ValueError(f"unknown tp_id {tp_id!r} for device {device_id!r}")
