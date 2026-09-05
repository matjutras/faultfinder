"""Resistance and diode-test modes for the simulated multimeter -- each a
real ngspice simulation on a modified copy of the netlist, not a relabeled
voltage reading (see CLAUDE.md's DMM mode selection future-work item).

Both modes use the same technique a real analog/digital multimeter uses:
zero every independent source in the circuit (so only the DUT's own
passive/semiconductor behavior is being probed, not whatever the circuit's
own power supply happens to be doing), inject a small test current between
the two probe points, and read back the resulting voltage. Resistance mode
divides that by the test current (Ohm's law); diode mode reads the voltage
directly as the forward drop. A probe pair with no real DC path between them
(or a diode facing the wrong way for the test current) can't sustain the
test current without an enormous voltage -- ngspice's op solver either
errors outright or converges to a value far beyond anything a real circuit
node would ever read, both treated as an open circuit ("0L" on a real meter),
never surfaced as a bogus number.
"""
from . import spice_runner

TEST_CURRENT_AMPS = 0.001  # 1mA -- a standard diode-test current, small enough not to disturb a resistor network

# Well above any resistance/voltage this project's devices produce when
# actually connected (its "open_pin" fault ties a disconnected pin to ground
# through a 1e12ohm resistor specifically so ngspice sees a stiff, solvable
# network instead of a literally-floating node -- so an open reads as a huge
# but finite number, not a solver error, and must be caught by magnitude too).
OPEN_RESISTANCE_OHMS = 1e6
OPEN_VOLTAGE_VOLTS = 10.0


def zero_independent_sources(circuit_text: str) -> str:
    """Replaces every independent V/I source's DC value with 0 -- a 0V
    source is an ideal short (superposition's standard way to deactivate a
    voltage source), a 0A source is an ideal open (ditto for a current
    source), so this leaves the network's own topology intact and just turns
    off whatever the circuit's own supply was doing."""
    out_lines = []
    for line in circuit_text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("*") or stripped.startswith("."):
            out_lines.append(line)
            continue
        tokens = stripped.split()
        if tokens[0][0].upper() in ("V", "I"):
            tokens[-1] = "0"
            out_lines.append(" ".join(tokens))
        else:
            out_lines.append(line)
    return "\n".join(out_lines) + "\n"


def inject_test_current(circuit_text: str, node_a: str, node_b: str, amps: float) -> str:
    """Adds an ideal current source that drives conventional current out of
    node_a, through the external network, into node_b -- i.e. as if the
    meter sources current out its red (node_a) lead and sinks it back in on
    black (node_b), the real convention a diode tester uses (verified
    against real ngspice output on diode_indicator_03: probing red=anode,
    black=cathode this way gives the diode's own small forward-ish drop;
    swapped leads on that same real device instead read the parallel
    resistor's own drop, since SPICE's own "I node1 node2" syntax drives
    current the *opposite* way -- out of node2, into node1 -- of what its
    argument order suggests at a glance). Inserted before .end like
    netlist.py's own patch-line insertion."""
    lines = circuit_text.rstrip().splitlines()
    insert_at = len(lines)
    for i, line in enumerate(lines):
        if line.strip().lower() == ".end":
            insert_at = i
            break
    lines[insert_at:insert_at] = [f"ITEST_DMM {node_b} {node_a} DC {amps}"]
    return "\n".join(lines) + "\n"


def _probe_voltage(circuit_text: str, node_a: str, node_b: str) -> float | None:
    """Runs the test-current simulation and returns V(node_a) - V(node_b),
    or None if the probe pair can't sustain the test current at all (a
    literal solver failure -- see module docstring)."""
    zeroed = zero_independent_sources(circuit_text)
    test_netlist = inject_test_current(zeroed, node_a, node_b, TEST_CURRENT_AMPS)
    try:
        voltages = spice_runner.simulate(test_netlist)
    except spice_runner.NgspiceError:
        return None
    v_a = voltages.get(node_a.upper(), 0.0)
    v_b = voltages.get(node_b.upper(), 0.0)
    return v_a - v_b


def measure_resistance_ohms(circuit_text: str, node_a: str, node_b: str) -> float | None:
    """None means open ("0L") -- either the solver failed, or the resulting
    resistance is far beyond anything a real connection in this circuit
    would produce. Unlike voltage/diode-forward-drop, resistance is reported
    as a magnitude: a real ohmmeter's reading doesn't depend on which lead
    (red/black) touched which point, only voltage and diode polarity do."""
    diff = _probe_voltage(circuit_text, node_a, node_b)
    if diff is None:
        return None
    ohms = abs(diff / TEST_CURRENT_AMPS)
    if ohms > OPEN_RESISTANCE_OHMS:
        return None
    return ohms


def measure_diode_forward_volts(circuit_text: str, node_a: str, node_b: str) -> float | None:
    """None means open ("0L") -- no forward conduction between the two
    probe points (an actual open, a reverse-biased diode, or two points with
    no diode between them at all that also happen to have no other DC path)."""
    diff = _probe_voltage(circuit_text, node_a, node_b)
    if diff is None or abs(diff) > OPEN_VOLTAGE_VOLTS:
        return None
    return diff
