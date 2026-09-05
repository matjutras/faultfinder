import shutil

import pytest

from app import dmm, netlist
from app.devices import load_circuit

requires_ngspice = pytest.mark.skipif(
    shutil.which("ngspice") is None, reason="ngspice not installed"
)


def test_zero_independent_sources_rewrites_only_the_trailing_dc_value():
    circuit = "V1 VIN 0 DC 9\nR1 VIN VOUT 1k\n.end\n"
    zeroed = dmm.zero_independent_sources(circuit)
    assert "V1 VIN 0 DC 0" in zeroed
    assert "R1 VIN VOUT 1k" in zeroed  # untouched -- not a source


def test_zero_independent_sources_handles_a_current_source_too():
    circuit = "I1 A B DC 0.5\n.end\n"
    assert "I1 A B DC 0" in dmm.zero_independent_sources(circuit)


def test_inject_test_current_inserts_before_end_like_netlist_patches():
    circuit = "* comment\nR1 A B 1k\n.end\n"
    out = dmm.inject_test_current(circuit, "A", "B", 0.001)
    lines = out.splitlines()
    assert lines.index("ITEST_DMM B A DC 0.001") < lines.index(".end")


@requires_ngspice
class TestResistanceMode:
    def test_healthy_voltage_divider_reads_r1_parallel_r2(self):
        # Verified against a real ngspice run: zeroing V1 ties VIN directly
        # to ground, so from VOUT's perspective R1 and R2 both run to the
        # same effective ground -- a real ohmmeter would read the same
        # parallel combination on this exact board.
        circuit = load_circuit("voltage_divider_01")
        ohms = dmm.measure_resistance_ohms(circuit, "VIN", "VOUT")
        assert ohms == pytest.approx(666.667, abs=0.01)  # 1k || 2k

    def test_resistance_is_a_magnitude_regardless_of_probe_order(self):
        circuit = load_circuit("voltage_divider_01")
        a_b = dmm.measure_resistance_ohms(circuit, "VIN", "VOUT")
        b_a = dmm.measure_resistance_ohms(circuit, "VOUT", "VIN")
        assert a_b == pytest.approx(b_a, abs=0.001)

    def test_r1_open_reroutes_through_the_alternate_path_not_falsely_open(self):
        # Real behavior, verified: opening R1 doesn't isolate VIN from VOUT
        # on this board -- there's a real alternate path back through the
        # (now-zeroed) V1 and R2, so a real meter would read that path's
        # resistance, not "0L".
        circuit = load_circuit("voltage_divider_01")
        patched = netlist.apply_patch(circuit, [{"ref": "R1", "to": "1e12"}])
        assert dmm.measure_resistance_ohms(patched, "VIN", "VOUT") == pytest.approx(2000.0, abs=0.01)

    def test_no_real_path_at_all_reads_open(self):
        # Opening *both* resistors leaves no real path between VIN and
        # VOUT at all -- verified this reads as open, not some huge but
        # finite number.
        circuit = load_circuit("voltage_divider_01")
        patched = netlist.apply_patch(circuit, [{"ref": "R1", "to": "1e12"}, {"ref": "R2", "to": "1e12"}])
        assert dmm.measure_resistance_ohms(patched, "VIN", "VOUT") is None


@requires_ngspice
class TestDiodeMode:
    def test_forward_direction_shows_the_diode_actually_conducting(self):
        # Verified against real ngspice output: on diode_indicator_03, R1
        # sits in parallel with D1 (both return to the zeroed V1's ground),
        # so probing red=anode(N1)/black=cathode(0) shows a slightly lower
        # drop than the pure-R1 case below -- the diode is genuinely sharing
        # some of the test current, not just relabeling a voltage reading.
        circuit = load_circuit("diode_indicator_03")
        forward = dmm.measure_diode_forward_volts(circuit, "N1", "0")
        assert forward == pytest.approx(0.4696388, abs=1e-4)

    def test_reversed_leads_read_the_parallel_resistor_instead(self):
        circuit = load_circuit("diode_indicator_03")
        reverse = dmm.measure_diode_forward_volts(circuit, "0", "N1")
        assert reverse == pytest.approx(0.47, abs=1e-4)  # 470ohm * 1mA test current, diode not conducting

    def test_forward_reads_lower_than_reverse_since_the_diode_only_helps_when_forward(self):
        circuit = load_circuit("diode_indicator_03")
        forward = dmm.measure_diode_forward_volts(circuit, "N1", "0")
        reverse = dmm.measure_diode_forward_volts(circuit, "0", "N1")
        assert forward < reverse
