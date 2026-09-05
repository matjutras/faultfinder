import shutil

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

requires_kicad = pytest.mark.skipif(
    shutil.which("kicad-cli") is None, reason="kicad-cli not installed"
)
requires_ngspice = pytest.mark.skipif(
    shutil.which("ngspice") is None, reason="ngspice not installed"
)


@requires_ngspice
def test_measure_r2_open_drops_tp2_to_max_through_the_real_pipeline():
    """No mocking anywhere: exercises the real map.json (from the milestone-2 KiCad
    importer, not hand-typed coordinates), the real netlist patch, and a real
    ngspice run together through the actual /measure endpoint. This is the case
    that a mocked-simulate test can't catch: if map.json's node names ever drift
    from what circuit.cir actually calls its nets (e.g. a stale TP->net mapping
    after re-importing from a changed schematic), this fails where a mock would
    stay green. Uses r2_open rather than r1_open because r1_open is the
    milestone-3 intermittent representative fault (see fault_gen.py) and would
    make this flaky.
    """
    healthy = client.post(
        "/api/devices/voltage_divider_01/measure",
        json={"tp_ids": ["TP1", "TP2"], "fault_id": "healthy"},
    ).json()
    faulted = client.post(
        "/api/devices/voltage_divider_01/measure",
        json={"tp_ids": ["TP1", "TP2"], "fault_id": "r2_open"},
    ).json()

    assert healthy["probes"]["TP1"] == pytest.approx(9.0, abs=0.01)
    assert healthy["probes"]["TP2"] == pytest.approx(6.0, abs=0.01)
    assert faulted["probes"]["TP1"] == pytest.approx(9.0, abs=0.01)
    assert faulted["probes"]["TP2"] == pytest.approx(9.0, abs=0.01)  # R2 open: no current, VOUT floats to VIN


@requires_ngspice
def test_intermittent_fault_sometimes_reads_healthy_and_sometimes_faulted():
    """r1_open is generated as the intermittent representative fault (see
    fault_gen.py). Statistical, not one-shot: repeated /measure calls for the
    same fault_id must show both a healthy-like and a faulted-like TP2 reading
    over enough tries, proving the miss-chance actually varies the simulated
    netlist rather than always applying (or always skipping) the patch.
    """
    readings = set()
    for _ in range(40):
        resp = client.post(
            "/api/devices/voltage_divider_01/measure",
            json={"tp_ids": ["TP1", "TP2"], "fault_id": "r1_open"},
        ).json()
        tp2 = resp["probes"]["TP2"]
        readings.add("healthy" if tp2 > 3.0 else "faulted")

    assert readings == {"healthy", "faulted"}


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


def test_list_devices_includes_every_device_directory():
    resp = client.get("/api/devices")
    assert resp.status_code == 200
    ids = {d["id"] for d in resp.json()}
    assert {"voltage_divider_01", "resistor_ladder_02", "diode_indicator_03",
            "transistor_switch_04", "resistor_bridge_05"} <= ids


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


def test_measure_r2_open_fault_changes_the_reading(monkeypatch):
    """The fault_id must actually flow through find_fault -> apply_patch -> simulate,
    not just get echoed back. Fakes simulate based on the patched circuit text so this
    fails if the patch stops being applied, even though it stays green under mocking.
    Uses r2_open rather than r1_open because r1_open is the milestone-3 intermittent
    representative fault (see fault_gen.py) and would make this flaky."""

    def fake_simulate(circuit_text):
        if "R2 VOUT 0 1e12" in circuit_text:
            return {"VIN": 9.0, "VOUT": 9.0}
        return {"VIN": 9.0, "VOUT": 6.0}

    monkeypatch.setattr("app.main.spice_runner.simulate", fake_simulate)

    healthy = client.post(
        "/api/devices/voltage_divider_01/measure",
        json={"tp_ids": ["TP1", "TP2"], "fault_id": "healthy"},
    ).json()
    faulted = client.post(
        "/api/devices/voltage_divider_01/measure",
        json={"tp_ids": ["TP1", "TP2"], "fault_id": "r2_open"},
    ).json()

    assert healthy["probes"]["TP2"] == 6.0
    assert faulted["probes"]["TP2"] == 9.0
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
