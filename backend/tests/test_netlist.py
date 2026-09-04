import shutil

import pytest

from app.netlist import apply_patch
from app.spice_runner import simulate

CIRCUIT = """* Simple Voltage Divider - FaultFinder device voltage_divider_01
V1 VIN 0 DC 9
R1 VIN VOUT 1k
R2 VOUT 0 2k
.end
"""

requires_ngspice = pytest.mark.skipif(
    shutil.which("ngspice") is None, reason="ngspice not installed"
)


def test_no_patch_returns_circuit_unchanged():
    assert apply_patch(CIRCUIT, []) == CIRCUIT


def test_patch_changes_component_value():
    patched = apply_patch(CIRCUIT, [{"ref": "R1", "to": "1e12"}])
    assert "R1 VIN VOUT 1e12" in patched
    assert "R2 VOUT 0 2k" in patched  # untouched


def test_patch_preserves_comment_and_directive_lines():
    patched = apply_patch(CIRCUIT, [{"ref": "R2", "to": "0.01"}])
    lines = patched.splitlines()
    assert lines[0].startswith("*")
    assert lines[-1] == ".end"


def test_patch_unknown_ref_raises():
    with pytest.raises(ValueError, match="R99"):
        apply_patch(CIRCUIT, [{"ref": "R99", "to": "1k"}])


def test_open_pin_rewrites_only_the_given_pin():
    patched = apply_patch(CIRCUIT, [{"op": "open_pin", "ref": "R1", "pin": 2}])
    assert "R1 VIN OPEN_R1_PIN2 1k" in patched
    assert "ROPEN_R1_2 OPEN_R1_PIN2 0 1e12" in patched
    assert "R2 VOUT 0 2k" in patched  # untouched


def test_add_short_appends_a_bridging_resistor_before_end():
    patched = apply_patch(CIRCUIT, [{"op": "add_short", "between": ["VOUT", "0"]}])
    lines = patched.splitlines()
    assert "RSHORT_VOUT_0 VOUT 0 1e-6" in lines
    assert lines[-1] == ".end"  # inserted before .end, not after


def test_unknown_op_raises():
    with pytest.raises(ValueError, match="frobnicate"):
        apply_patch(CIRCUIT, [{"op": "frobnicate", "ref": "R1"}])


@requires_ngspice
def test_open_pin_isolates_downstream_node():
    patched = apply_patch(CIRCUIT, [{"op": "open_pin", "ref": "R1", "pin": 2}])
    voltages = simulate(patched)
    assert voltages["VOUT"] == pytest.approx(0.0, abs=0.01)


@requires_ngspice
def test_add_short_pulls_both_nodes_to_the_same_voltage():
    patched = apply_patch(CIRCUIT, [{"op": "add_short", "between": ["VOUT", "0"]}])
    voltages = simulate(patched)
    assert voltages["VOUT"] == pytest.approx(0.0, abs=0.01)
