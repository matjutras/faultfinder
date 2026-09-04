import shutil

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

requires_kicad = pytest.mark.skipif(
    shutil.which("kicad-cli") is None, reason="kicad-cli not installed"
)


@requires_kicad
def test_import_device_regenerates_map_from_real_kicad_source():
    resp = client.post("/api/devices/voltage_divider_01/import")
    assert resp.status_code == 200
    by_ref = {tp["tp_id"]: tp for tp in resp.json()["testpoints"]}
    assert by_ref["TP1"]["node"] == "VIN"
    assert by_ref["TP2"]["node"] == "VOUT"
    assert by_ref["TP3"]["node"] == "0"


def test_import_unknown_device_404():
    resp = client.post("/api/devices/nope/import")
    assert resp.status_code == 404


def test_get_device_returns_testpoints_and_faults():
    resp = client.get("/api/devices/voltage_divider_01")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["testpoints"]) == 3
    assert any(f["id"] == "r1_open" for f in body["faults"])


def test_get_unknown_device_404():
    resp = client.get("/api/devices/nope")
    assert resp.status_code == 404


def test_measure_healthy_circuit(monkeypatch):
    monkeypatch.setattr(
        "app.main.spice_runner.simulate",
        lambda circuit_text: {"VIN": 9.0, "VOUT": 6.0},
    )
    resp = client.post(
        "/api/devices/voltage_divider_01/measure",
        json={"tp_ids": ["TP1", "TP2"], "fault_id": "healthy"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["probes"] == {"TP1": 9.0, "TP2": 6.0}
    assert body["differential_volts"] == 3.0


def test_measure_r1_open_fault_changes_the_reading(monkeypatch):
    """The fault_id must actually flow through find_fault -> apply_patch -> simulate,
    not just get echoed back. Fakes simulate based on the patched circuit text so this
    fails if the patch stops being applied, even though it stays green under mocking."""

    def fake_simulate(circuit_text):
        if "R1 VIN VOUT 1e12" in circuit_text:
            return {"VIN": 9.0, "VOUT": 0.0}
        return {"VIN": 9.0, "VOUT": 6.0}

    monkeypatch.setattr("app.main.spice_runner.simulate", fake_simulate)

    healthy = client.post(
        "/api/devices/voltage_divider_01/measure",
        json={"tp_ids": ["TP1", "TP2"], "fault_id": "healthy"},
    ).json()
    faulted = client.post(
        "/api/devices/voltage_divider_01/measure",
        json={"tp_ids": ["TP1", "TP2"], "fault_id": "r1_open"},
    ).json()

    assert healthy["probes"]["TP2"] == 6.0
    assert faulted["probes"]["TP2"] == 0.0
    assert faulted["differential_volts"] != healthy["differential_volts"]


def test_measure_requires_exactly_two_probes():
    resp = client.post(
        "/api/devices/voltage_divider_01/measure",
        json={"tp_ids": ["TP1"], "fault_id": "healthy"},
    )
    assert resp.status_code == 400


def test_measure_unknown_testpoint():
    resp = client.post(
        "/api/devices/voltage_divider_01/measure",
        json={"tp_ids": ["TP1", "TP99"], "fault_id": "healthy"},
    )
    assert resp.status_code == 400
