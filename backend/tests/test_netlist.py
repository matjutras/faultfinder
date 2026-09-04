import pytest

from app.netlist import apply_patch

CIRCUIT = """* Simple Voltage Divider - FaultFinder device voltage_divider_01
V1 VIN 0 DC 9
R1 VIN VOUT 1k
R2 VOUT 0 2k
.end
"""


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
