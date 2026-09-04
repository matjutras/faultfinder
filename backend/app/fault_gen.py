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
        # base, emitter). Everything else falls back to "trailing token is a
        # plain numeric value" -- true for R/L/C, and a safe default otherwise.
        if prefix in ("V", "I", "D"):
            nodes, value = tokens[1:3], None
        elif prefix == "Q":
            nodes, value = tokens[1:4], None
        elif len(tokens) > 1 and _NUMERIC_VALUE_RE.match(tokens[-1]):
            nodes, value = tokens[1:-1], tokens[-1]
        else:
            nodes, value = tokens[1:], None

        components.append(Component(ref, nodes, value))
    return components


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
