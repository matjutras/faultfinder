import shutil

import pytest

from app import kicad_import

requires_kicad = pytest.mark.skipif(
    shutil.which("kicad-cli") is None, reason="kicad-cli not installed"
)


@requires_kicad
def test_import_testpoints_resolves_real_nets_and_placements():
    testpoints = kicad_import.import_testpoints("voltage_divider_01")
    by_ref = {tp["tp_id"]: tp for tp in testpoints}

    assert by_ref["TP1"]["node"] == "VIN"
    assert by_ref["TP2"]["node"] == "VOUT"
    assert by_ref["TP3"]["node"] == "0"

    # x/y come from the schematic's own symbol placement, not hand-typed guesses.
    assert by_ref["TP1"]["x_mm"] == pytest.approx(50.8)
    assert by_ref["TP1"]["y_mm"] == pytest.approx(39.37)


def test_resolve_testpoint_nets_strips_sheet_path_and_maps_gnd_to_zero():
    xml = """<?xml version="1.0"?>
    <export>
      <nets>
        <net code="1" name="/VIN"><node ref="TP1" pin="1"/><node ref="R1" pin="1"/></net>
        <net code="2" name="GND"><node ref="TP3" pin="1"/><node ref="V1" pin="2"/></net>
      </nets>
    </export>"""
    nets = kicad_import.resolve_testpoint_nets(xml)
    assert nets == {"TP1": "VIN", "TP3": "0"}


def test_parse_symbol_placements_ignores_lib_symbols_cache():
    sch_text = """(kicad_sch
\t(lib_symbols
\t\t(symbol "Connector:TestPoint"
\t\t\t(property "Reference" "TP"
\t\t\t\t(at 999 999 0)
\t\t\t)
\t\t)
\t)
\t(symbol
\t\t(lib_id "Connector:TestPoint")
\t\t(at 101.6 81.28 0)
\t\t(property "Reference" "TP1"
\t\t\t(at 101.6 88.138 0)
\t\t)
\t)
)
"""
    placements = kicad_import.parse_symbol_placements(sch_text)
    assert placements == {"TP1": (101.6, 81.28)}


def test_parse_testpoints_raises_on_ref_mismatch():
    xml = """<?xml version="1.0"?>
    <export><nets>
      <net code="1" name="/VIN"><node ref="TP1" pin="1"/></net>
    </nets></export>"""
    sch_text = """(kicad_sch
\t(symbol
\t\t(lib_id "Connector:TestPoint")
\t\t(at 1 2 0)
\t\t(property "Reference" "TP2"
\t\t\t(at 1 2 0)
\t\t)
\t)
)
"""
    with pytest.raises(ValueError):
        kicad_import.parse_testpoints(xml, sch_text)
