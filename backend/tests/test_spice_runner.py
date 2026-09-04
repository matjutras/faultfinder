import shutil

import pytest

from app import netlist
from app.devices import load_circuit
from app.spice_runner import simulate

requires_ngspice = pytest.mark.skipif(
    shutil.which("ngspice") is None, reason="ngspice not installed"
)


@requires_ngspice
def test_simulate_healthy_voltage_divider():
    circuit = load_circuit("voltage_divider_01")
    voltages = simulate(circuit)
    assert voltages["VIN"] == pytest.approx(9.0, abs=0.01)
    assert voltages["VOUT"] == pytest.approx(6.0, abs=0.01)


@requires_ngspice
def test_simulate_r1_open_pulls_output_to_zero():
    circuit = load_circuit("voltage_divider_01")
    patched = netlist.apply_patch(circuit, [{"ref": "R1", "to": "1e12"}])
    voltages = simulate(patched)
    assert voltages["VOUT"] == pytest.approx(0.0, abs=0.01)
