"""Netlist patching. Generic across devices: a patch changes a component's value
by matching its ref designator as the first token of its SPICE card, per CLAUDE.md
("Never hardcode canonical net names per device").
"""


def apply_patch(circuit_text: str, patch: list[dict]) -> str:
    patch_by_ref = {p["ref"]: p["to"] for p in patch}
    if not patch_by_ref:
        return circuit_text

    out_lines = []
    applied = set()
    for line in circuit_text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("*") or stripped.startswith("."):
            out_lines.append(line)
            continue

        ref = stripped.split()[0]
        if ref in patch_by_ref:
            tokens = stripped.split()
            tokens[-1] = patch_by_ref[ref]
            out_lines.append(" ".join(tokens))
            applied.add(ref)
        else:
            out_lines.append(line)

    missing = set(patch_by_ref) - applied
    if missing:
        raise ValueError(f"patch referenced components not found in netlist: {sorted(missing)}")

    return "\n".join(out_lines) + "\n"
