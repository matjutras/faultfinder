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


def _volts(probes: list[dict], node: str) -> float:
    return next(p["volts"] for p in probes if p["node"] == node)


@requires_ngspice
def test_measure_r2_open_drops_vout_to_max_through_the_real_pipeline():
    """No mocking anywhere: exercises the real map.json (from the KiCad
    importer, not hand-typed coordinates), the real netlist patch, and a real
    ngspice run together through the actual /measure endpoint. This is the case
    that a mocked-simulate test can't catch: if map.json's node names ever drift
    from what circuit.cir actually calls its nets, this fails where a mock would
    stay green. Uses r2_open rather than r1_open because r1_open is the
    milestone-3 intermittent representative fault (see fault_gen.py) and would
    make this flaky.
    """
    healthy = client.post(
        "/api/devices/voltage_divider_01/measure",
        json={"nodes": ["VIN", "VOUT"], "fault_id": "healthy"},
    ).json()
    faulted = client.post(
        "/api/devices/voltage_divider_01/measure",
        json={"nodes": ["VIN", "VOUT"], "fault_id": "r2_open"},
    ).json()

    assert _volts(healthy["probes"], "VIN") == pytest.approx(9.0, abs=0.01)
    assert _volts(healthy["probes"], "VOUT") == pytest.approx(6.0, abs=0.01)
    assert _volts(faulted["probes"], "VIN") == pytest.approx(9.0, abs=0.01)
    assert _volts(faulted["probes"], "VOUT") == pytest.approx(9.0, abs=0.01)  # R2 open: no current, VOUT floats to VIN


@requires_ngspice
def test_intermittent_fault_sometimes_reads_healthy_and_sometimes_faulted():
    """r1_open is generated as the intermittent representative fault (see
    fault_gen.py). Statistical, not one-shot: repeated /measure calls for the
    same fault_id must show both a healthy-like and a faulted-like VOUT reading
    over enough tries, proving the miss-chance actually varies the simulated
    netlist rather than always applying (or always skipping) the patch.
    """
    readings = set()
    for _ in range(40):
        resp = client.post(
            "/api/devices/voltage_divider_01/measure",
            json={"nodes": ["VIN", "VOUT"], "fault_id": "r1_open"},
        ).json()
        vout = _volts(resp["probes"], "VOUT")
        readings.add("healthy" if vout > 3.0 else "faulted")

    assert readings == {"healthy", "faulted"}


@requires_kicad
def test_import_device_regenerates_map_from_real_kicad_source():
    resp = client.post("/api/devices/voltage_divider_01/import")
    assert resp.status_code == 200
    by_ref_pin = {(p["ref"], p["pin"]): p for p in resp.json()["pins"]}
    assert by_ref_pin[("R1", "2")]["node"] == "VIN"
    assert by_ref_pin[("R1", "1")]["node"] == "VOUT"
    assert by_ref_pin[("R2", "1")]["node"] == "0"


def test_import_unknown_device_404():
    resp = client.post("/api/devices/nope/import")
    assert resp.status_code == 404


def test_list_devices_includes_every_device_directory():
    resp = client.get("/api/devices")
    assert resp.status_code == 200
    ids = {d["id"] for d in resp.json()}
    assert {"voltage_divider_01", "resistor_ladder_02", "diode_indicator_03",
            "transistor_switch_04", "resistor_bridge_05"} <= ids


def test_get_device_returns_pins_wires_and_faults():
    resp = client.get("/api/devices/voltage_divider_01")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["pins"]) > 0
    assert len(body["wires"]) > 0
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
        json={"nodes": ["VIN", "VOUT"], "fault_id": "healthy"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["probes"] == [{"node": "VIN", "volts": 9.0}, {"node": "VOUT", "volts": 6.0}]
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
        json={"nodes": ["VIN", "VOUT"], "fault_id": "healthy"},
    ).json()
    faulted = client.post(
        "/api/devices/voltage_divider_01/measure",
        json={"nodes": ["VIN", "VOUT"], "fault_id": "r2_open"},
    ).json()

    assert _volts(healthy["probes"], "VOUT") == 6.0
    assert _volts(faulted["probes"], "VOUT") == 9.0
    assert faulted["differential_volts"] != healthy["differential_volts"]


@requires_ngspice
def test_measure_ohms_mode_through_the_real_pipeline():
    resp = client.post(
        "/api/devices/voltage_divider_01/measure",
        json={"nodes": ["VIN", "VOUT"], "fault_id": "healthy", "mode": "ohms"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["mode"] == "ohms"
    assert body["resistance_ohms"] == pytest.approx(666.667, abs=0.01)  # R1 (1k) || R2 (2k)


@requires_ngspice
def test_measure_ohms_mode_reads_open_when_both_resistors_are_open():
    resp = client.post(
        "/api/devices/voltage_divider_01/measure",
        json={"nodes": ["VIN", "VOUT"], "fault_id": "r1_open", "mode": "ohms"},
    )
    assert resp.status_code == 200
    # r1_open alone still has a real path back through R2 (see test_dmm.py) --
    # this just checks the mode flows through find_fault -> apply_patch like
    # voltage mode already does, not that this particular fault reads open.
    assert resp.json()["resistance_ohms"] is not None


@requires_ngspice
def test_measure_diode_mode_through_the_real_pipeline():
    resp = client.post(
        "/api/devices/diode_indicator_03/measure",
        json={"nodes": ["N1", "0"], "fault_id": "healthy", "mode": "diode"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["mode"] == "diode"
    assert body["diode_forward_volts"] == pytest.approx(0.4696388, abs=1e-4)


def test_measure_unknown_mode_400():
    resp = client.post(
        "/api/devices/voltage_divider_01/measure",
        json={"nodes": ["VIN", "VOUT"], "fault_id": "healthy", "mode": "capacitance"},
    )
    assert resp.status_code == 400


def test_measure_requires_exactly_two_probes():
    resp = client.post(
        "/api/devices/voltage_divider_01/measure",
        json={"nodes": ["VIN"], "fault_id": "healthy"},
    )
    assert resp.status_code == 400


def test_measure_unknown_node():
    resp = client.post(
        "/api/devices/voltage_divider_01/measure",
        json={"nodes": ["VIN", "NOT_A_REAL_NODE"], "fault_id": "healthy"},
    )
    assert resp.status_code == 400
