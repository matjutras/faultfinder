"""Auto-generates a device's default fault pool from its circuit.cir, per
CLAUDE.md's per-component-ref-prefix table (R->open, C->short+open, D->open+short,
L->open, Q->junction-open or leaky-short, U/IC->single-pin-open), plus generic
value-drift and net-pair short faults. Driven only by parsing circuit_text (ref
prefixes, node lists) -- no per-device net-name hardcoding, no KiCad involvement.
"""

import itertools
import re

DRIFT_HIGH = 10
DRIFT_LOW = 0.1

_NUMERIC_VALUE_RE = re.compile(r"^[-+]?[0-9]*\.?[0-9]+[a-zA-Z]*$")
_SLUG_RE = re.compile(r"[^A-Za-z0-9]+")

# Every first letter ngspice's own element-type table reserves for a specific
# kind of circuit element, mapped to what it actually means. battery_protection_09
# hit this for real with a fuse ref'd "F1" (SPICE's current-controlled-current-
# source prefix) -- but that fix (see CLAUDE.md) only special-cased "F" itself,
# so the *next* real board's own ref designator ("T1" for a terminal block, "K1"
# for a connector, "S1" for a switch...) would hit the identical class of bug
# under a different letter with nothing here to catch it. This is every letter
# ngspice reserves, not just the one seen so far.
RESERVED_SPICE_PREFIXES: dict[str, str] = {
    "B": "GaAs FET / behavioral source",
    "E": "voltage-controlled voltage source",
    "F": "current-controlled current source",
    "G": "voltage-controlled current source",
    "H": "current-controlled voltage source",
    "J": "JFET",
    "K": "mutual inductance / coupled inductors",
    "O": "lossy transmission line",
    "S": "voltage-controlled switch",
    "T": "lossless transmission line",
    "U": "uniform distributed RC line",
    "W": "current-controlled switch",
    "X": "subcircuit call",
    "Z": "MESFET / IGBT",
}

# The prefixes this project's own parse_components/_per_component_faults
# below actually model correctly today. Anything else colliding with
# RESERVED_SPICE_PREFIXES is unimplemented and dangerous to alias onto an
# unrelated real-world part, exactly as "F" was for battery_protection_09's fuse.
_MODELED_PREFIXES = {"R", "C", "L", "D", "Q", "M", "V", "I"}

# R/L/C are also reserved letters, but this project *does* model them --
# always as a plain 2-terminal part with a trailing numeric value. A line
# whose ref starts with one of these but has no such value (parse_components
# then had nothing numeric to treat as the value) means the ref just happens
# to start with this letter without actually being that part -- exactly how
# battery_protection_09's LED, ref "LED1", collided with SPICE's inductor
# prefix "L": "LED1 node1 node2 LEDMOD" has no numeric inductance, "LEDMOD"
# is a diode model name, so it isn't really an inductor line at all.
_NUMERIC_VALUE_ELEMENT_NAME = {"R": "resistor", "L": "inductor", "C": "capacitor"}


class ReservedSpicePrefixError(Exception):
    pass


class Component:
    __slots__ = ("ref", "prefix", "nodes", "value")

    def __init__(self, ref: str, nodes: list[str], value: str | None):
        self.ref = ref
        self.prefix = ref[0].upper()
        self.nodes = nodes
        self.value = value


def _slug(name: str) -> str:
    return _SLUG_RE.sub("_", name).strip("_").lower()


def _fault(fault_id: str, name: str, difficulty: str, kind: str, patch: list[dict]) -> dict:
    return {"id": fault_id.lower(), "name": name, "difficulty": difficulty, "kind": kind, "patch": patch}


def parse_components(circuit_text: str) -> list[Component]:
    components = []
    for line in circuit_text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("*") or stripped.startswith("."):
            continue
        tokens = stripped.split()
        ref = tokens[0]
        prefix = ref[0].upper()

        # Node-count conventions are universal SPICE facts (not per-device data):
        # independent sources and diodes always have exactly 2 terminal nodes as
        # their first two arguments (sources may be followed by "DC <value>",
        # "AC ...", etc, which aren't nodes); BJTs have exactly 3 (collector,
        # base, emitter); MOSFETs have exactly 4 (drain, gate, source, bulk) --
        # found importing reverse_polarity_08's discrete P-MOSFET: without this
        # case, the trailing model name (e.g. "PMOSMOD") was misparsed as a 5th
        # "node", which _net_pair_faults then happily generated a bogus
        # short-to-model-name fault for, tying a real net to a phantom
        # single-connection node ngspice can't solve. Everything else falls
        # back to "trailing token is a plain numeric value" -- true for R/L/C,
        # and a safe default otherwise.
        if prefix in ("V", "I", "D"):
            nodes, value = tokens[1:3], None
        elif prefix == "Q":
            nodes, value = tokens[1:4], None
        elif prefix == "M":
            nodes, value = tokens[1:5], None
        elif len(tokens) > 1 and _NUMERIC_VALUE_RE.match(tokens[-1]):
            nodes, value = tokens[1:-1], tokens[-1]
        else:
            nodes, value = tokens[1:], None

        components.append(Component(ref, nodes, value))
    return components


def validate_circuit_refs(components: list[Component]) -> None:
    """Raises with a clear, actionable message the moment circuit.cir uses a
    ref that collides with a SPICE-reserved element-type prefix, instead of
    leaving it to surface later as ngspice's own cryptic "not enough
    parameters"/similar error deep inside a /measure call (or, worse, a
    silently misparsed phantom node the way "LED1" and "M1" both were before
    their respective fixes -- see this module's own comments). Call this at
    import/registration time (see main.py's /import route), not simulation
    time, so a bad ref is caught before a device is ever playable."""
    for c in components:
        if c.prefix in _NUMERIC_VALUE_ELEMENT_NAME and c.value is None:
            raise ReservedSpicePrefixError(
                f"circuit.cir ref {c.ref!r} starts with {c.prefix!r}, which "
                f"SPICE parses as a plain {_NUMERIC_VALUE_ELEMENT_NAME[c.prefix]} "
                f"needing a trailing numeric value -- but this line has none, "
                f"which means it's very likely a different kind of part whose "
                f"ref just happens to start with {c.prefix!r} (this is exactly "
                f"how battery_protection_09's LED, ref 'LED1', collided with "
                f"SPICE's inductor prefix 'L'). Rename it in circuit.cir; the "
                f"schematic's own ref designator is unaffected."
            )
        if c.prefix in _MODELED_PREFIXES:
            continue
        meaning = RESERVED_SPICE_PREFIXES.get(c.prefix)
        if meaning is not None:
            raise ReservedSpicePrefixError(
                f"circuit.cir ref {c.ref!r} starts with {c.prefix!r}, which "
                f"SPICE reserves for a {meaning} -- not a component this "
                f"project models under that letter. Rename it in circuit.cir "
                f"(the schematic's own ref designator is unaffected; see "
                f"CLAUDE.md's battery_protection_09 note for the same fix "
                f"applied to a fuse ref 'F1')."
            )


def _drift_value(value: str, factor: float) -> str:
    m = re.match(r"^([-+]?[0-9]*\.?[0-9]+)([a-zA-Z]*)$", value)
    if not m:
        return value
    number, suffix = m.groups()
    return f"{float(number) * factor:g}{suffix}"


def _all_nets(components: list[Component]) -> set[str]:
    nets: set[str] = set()
    for c in components:
        nets.update(c.nodes)
    return nets


def _vcc_net(components: list[Component]) -> str | None:
    for c in components:
        if c.prefix == "V" and c.nodes:
            return c.nodes[0]
    return None


def _per_component_faults(components: list[Component]) -> list[dict]:
    faults = []
    for c in components:
        if c.prefix in ("V", "I"):
            continue  # sources are boundary conditions, not failing components

        if c.prefix == "R":
            faults.append(_fault(f"{c.ref}_open", f"{c.ref} open circuit", "easy", "component_failed", [{"ref": c.ref, "to": "1e12"}]))
        elif c.prefix == "L":
            faults.append(_fault(f"{c.ref}_open", f"{c.ref} open circuit", "easy", "component_failed", [{"op": "open_pin", "ref": c.ref, "pin": 1}]))
        elif c.prefix == "C":
            faults.append(_fault(f"{c.ref}_open", f"{c.ref} open circuit", "easy", "component_failed", [{"ref": c.ref, "to": "1f"}]))
            if len(c.nodes) >= 2:
                faults.append(_fault(f"{c.ref}_short", f"{c.ref} short circuit", "hard", "component_failed", [{"op": "add_short", "between": c.nodes[:2]}]))
        elif c.prefix == "D":
            faults.append(_fault(f"{c.ref}_open", f"{c.ref} open circuit", "easy", "component_failed", [{"op": "open_pin", "ref": c.ref, "pin": 1}]))
            if len(c.nodes) >= 2:
                faults.append(_fault(f"{c.ref}_short", f"{c.ref} short circuit", "hard", "component_failed", [{"op": "add_short", "between": c.nodes[:2]}]))
        elif c.prefix == "Q":
            if len(c.nodes) >= 2:
                faults.append(_fault(f"{c.ref}_junction_open", f"{c.ref} junction open (base)", "medium", "open_pin", [{"op": "open_pin", "ref": c.ref, "pin": 2}]))
            if len(c.nodes) >= 3:
                faults.append(_fault(f"{c.ref}_leaky_short", f"{c.ref} leaky short (base-emitter)", "hard", "component_failed", [{"op": "add_short", "between": [c.nodes[1], c.nodes[2]], "resistance": "1k"}]))
        elif c.prefix == "M":
            # Node order is this project's own circuit.cir convention (drain,
            # gate, source, bulk -- see parse_components). Opens the *drain*
            # (pin 1, the main conduction terminal), not the gate: verified
            # against a real ngspice run on reverse_polarity_08 that a
            # gate-open fault is a silent no-op whenever the healthy circuit
            # already biases the gate near ground through a resistor (a
            # common gate-pulldown topology, true of that device) -- an ideal
            # MOSFET model draws zero DC gate current either way, so tying the
            # gate to a *different* resistor-to-ground changes nothing
            # measurable. A BJT's base-open (see the Q case above) doesn't
            # have this problem since real base current is required for the
            # transistor to conduct at all -- MOSFETs and BJTs aren't
            # actually analogous here despite both being 3-terminal switches.
            # Drain-open, like every other component's primary-terminal open
            # fault (R/L/D/C), always removes the main current path.
            if len(c.nodes) >= 3:
                faults.append(_fault(f"{c.ref}_open", f"{c.ref} open circuit (drain)", "easy", "component_failed", [{"op": "open_pin", "ref": c.ref, "pin": 1}]))
                faults.append(_fault(f"{c.ref}_leaky_short", f"{c.ref} leaky short (drain-source)", "hard", "component_failed", [{"op": "add_short", "between": [c.nodes[0], c.nodes[2]], "resistance": "1k"}]))
        elif c.nodes:
            faults.append(_fault(f"{c.ref}_pin1_open", f"{c.ref} pin 1 open", "medium", "open_pin", [{"op": "open_pin", "ref": c.ref, "pin": 1}]))

        if c.value is not None:
            faults.append(_fault(f"{c.ref}_drift_high", f"{c.ref} value drifted high", "medium", "component_change", [{"ref": c.ref, "to": _drift_value(c.value, DRIFT_HIGH)}]))
            faults.append(_fault(f"{c.ref}_drift_low", f"{c.ref} value drifted low", "medium", "component_change", [{"ref": c.ref, "to": _drift_value(c.value, DRIFT_LOW)}]))

    return faults


def _net_pair_faults(components: list[Component]) -> list[dict]:
    nets = sorted(_all_nets(components))
    vcc = _vcc_net(components)

    faults = []
    for a, b in itertools.combinations(nets, 2):
        if vcc and {a, b} == {"0", vcc}:
            # An ideal voltage source's own two terminals are both already
            # voltage-defined boundary conditions -- shorting them together
            # doesn't perturb the operating point at all under DC-op (verified
            # against a real ngspice run, not assumed), so this pairing is a
            # physically real but simulation-invisible degenerate case.
            continue
        if a == "0" or b == "0":
            kind, difficulty = "short_to_ground", "medium"
        elif vcc and (a == vcc or b == vcc):
            kind, difficulty = "short_to_vcc", "medium"
        else:
            kind, difficulty = "short_between_nodes", "hard"

        faults.append(
            _fault(f"short_{_slug(a)}_{_slug(b)}", f"{a} shorted to {b}", difficulty, kind, [{"op": "add_short", "between": [a, b]}])
        )
    return faults


def generate_fault_pool(circuit_text: str) -> list[dict]:
    components = parse_components(circuit_text)
    validate_circuit_refs(components)
    per_component = _per_component_faults(components)
    net_pair = _net_pair_faults(components)

    # Mark exactly one representative fault as intermittent rather than
    # generating a parallel copy of every fault -- keeps the pool size sane
    # while still exercising the mechanic. By construction, the first fault
    # appended for any component is always an "open" fault, so per_component[0]
    # (if any components exist) is a reasonable, easy-to-reason-about pick.
    # It's bumped to "hard" regardless of the underlying fault's own tier: a
    # connection that only sometimes reads faulted is a harder diagnosis than
    # a stable one, so it can't stay classified as "easy" just because R/L/D
    # opens normally are.
    if per_component:
        per_component[0] = {**per_component[0], "difficulty": "hard", "intermittent": True}

    return per_component + net_pair
