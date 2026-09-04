"""Netlist patching. Generic across devices: patches describe circuit mutations
by component ref / net name, never by hardcoded per-device net names, per
CLAUDE.md ("Never hardcode canonical net names per device").

Three patch ops. Existing `{"ref": ..., "to": ...}` entries (no "op") are
"value_change" for backward compatibility.

  - value_change: replace a component's trailing value token (e.g. a resistor's
    "1k" -> "1e12" to simulate an open).
  - open_pin: rewrite one specific pin's node to a fresh, unused net and tie that
    net to ground through a large resistor. Needed because literally floating a
    node makes ngspice error on under-connected nodes, and because a bare
    value_change doesn't produce an open circuit for components whose value
    token isn't a DC-relevant resistance (inductor henries, diode model names).
  - add_short: append a new resistor bridging two existing nets -- near-zero
    resistance for a hard short, a moderate value for a "leaky" one.
"""

import re

_SANITIZE_RE = re.compile(r"[^A-Za-z0-9]")


def _sanitize(name: str) -> str:
    return _SANITIZE_RE.sub("_", name)


def apply_patch(circuit_text: str, patch: list[dict]) -> str:
    if not patch:
        return circuit_text

    trailing_value_by_ref: dict[str, str] = {}
    pin_rewrite_by_ref: dict[str, dict[int, str]] = {}
    extra_lines: list[str] = []

    for entry in patch:
        op = entry.get("op", "value_change")
        if op == "value_change":
            trailing_value_by_ref[entry["ref"]] = entry["to"]
        elif op == "open_pin":
            ref, pin = entry["ref"], entry["pin"]
            synth_net = f"OPEN_{_sanitize(ref)}_PIN{pin}"
            pin_rewrite_by_ref.setdefault(ref, {})[pin] = synth_net
            extra_lines.append(f"ROPEN_{_sanitize(ref)}_{pin} {synth_net} 0 1e12")
        elif op == "add_short":
            a, b = entry["between"]
            resistance = entry.get("resistance", "1e-6")
            extra_lines.append(f"RSHORT_{_sanitize(a)}_{_sanitize(b)} {a} {b} {resistance}")
        else:
            raise ValueError(f"unknown patch op {op!r}")

    out_lines = []
    applied: set[str] = set()
    for line in circuit_text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("*") or stripped.startswith("."):
            out_lines.append(line)
            continue

        tokens = stripped.split()
        ref = tokens[0]
        changed = False

        if ref in trailing_value_by_ref:
            tokens[-1] = trailing_value_by_ref[ref]
            applied.add(ref)
            changed = True

        if ref in pin_rewrite_by_ref:
            for pin, new_node in pin_rewrite_by_ref[ref].items():
                tokens[pin] = new_node
            applied.add(ref)
            changed = True

        out_lines.append(" ".join(tokens) if changed else line)

    missing = (set(trailing_value_by_ref) | set(pin_rewrite_by_ref)) - applied
    if missing:
        raise ValueError(f"patch referenced components not found in netlist: {sorted(missing)}")

    if extra_lines:
        insert_at = len(out_lines)
        for i, line in enumerate(out_lines):
            if line.strip().lower() == ".end":
                insert_at = i
                break
        out_lines[insert_at:insert_at] = extra_lines

    return "\n".join(out_lines) + "\n"
