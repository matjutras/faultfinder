import re
import subprocess
import tempfile
from pathlib import Path

SIM_DIRECTIVE = """
.control
op
print all
.endc
"""

NODE_VOLTAGE_RE = re.compile(r"^([A-Za-z_][\w]*)\s*=\s*([-+0-9.eE]+)\s*$")


class NgspiceError(Exception):
    pass


def build_sim_netlist(circuit_text: str) -> str:
    text = circuit_text.rstrip()
    if text.lower().endswith(".end"):
        text = text[: -len(".end")].rstrip()
    return f"{text}\n{SIM_DIRECTIVE}\n.end\n"


def run_ngspice(netlist_text: str) -> str:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".cir", delete=False) as f:
        f.write(netlist_text)
        path = f.name
    try:
        result = subprocess.run(
            ["ngspice", "-b", path],
            capture_output=True,
            text=True,
            timeout=15,
        )
    finally:
        Path(path).unlink(missing_ok=True)

    if result.returncode != 0:
        raise NgspiceError(result.stderr or result.stdout)
    return result.stdout


def parse_op_voltages(raw_output: str) -> dict[str, float]:
    voltages: dict[str, float] = {}
    for line in raw_output.splitlines():
        m = NODE_VOLTAGE_RE.match(line.strip())
        if not m:
            continue
        name, value = m.groups()
        if name.endswith("#branch"):
            continue
        voltages[name.upper()] = float(value)
    return voltages


def simulate(circuit_text: str) -> dict[str, float]:
    raw = run_ngspice(build_sim_netlist(circuit_text))
    return parse_op_voltages(raw)
