import shutil

import pytest

from app import kicad_import

requires_kicad = pytest.mark.skipif(
    shutil.which("kicad-cli") is None, reason="kicad-cli not installed"
)


@requires_kicad
def test_import_probe_geometry_resolves_every_pin_not_just_testpoints():
    geo = kicad_import.import_probe_geometry("voltage_divider_01")
    by_ref_pin = {(p["ref"], p["pin"]): p for p in geo["pins"]}

    # every component's pins are present, not just TP-prefixed refs
    assert set(ref for ref, _ in by_ref_pin) == {"V1", "R1", "R2", "TP1", "TP2", "TP3"}

    # nets resolve correctly for a real component pin, same as they always did for TPs
    assert by_ref_pin[("R1", "1")]["node"] == "VOUT"
    assert by_ref_pin[("R1", "2")]["node"] == "VIN"

    # x/y come from the schematic's own symbol placement + the real pin
    # geometry in its embedded lib_symbols cache, not hand-typed guesses
    assert by_ref_pin[("TP1", "1")]["x_mm"] == pytest.approx(50.8)
    assert by_ref_pin[("TP1", "1")]["y_mm"] == pytest.approx(39.37)


@requires_kicad
def test_import_probe_geometry_reports_the_hand_authored_devices_own_page_size():
    geo = kicad_import.import_probe_geometry("voltage_divider_01")
    assert geo["page_width_mm"] == pytest.approx(100.0)
    assert geo["page_height_mm"] == pytest.approx(110.0)


@requires_kicad
def test_import_probe_geometry_reports_a_real_devices_standard_page_size():
    # bridge_rectifier_06 is a real-world import declaring plain "(paper
    # "A4")" -- no explicit width/height like the hand-authored devices'
    # "(paper "User" 100 110)". Its own pins go up to x=129.5mm, which
    # wouldn't even fit on a 100mm-wide page, so getting this wrong is a
    # real, silent probe-placement bug, not just a cosmetic one.
    geo = kicad_import.import_probe_geometry("bridge_rectifier_06")
    assert geo["page_width_mm"] == pytest.approx(297.0)  # A4 landscape (no "portrait" keyword present)
    assert geo["page_height_mm"] == pytest.approx(210.0)


def test_parse_page_size_mm_reads_the_hand_authored_convention():
    assert kicad_import.parse_page_size_mm('(paper "User" 100 110)') == (100.0, 110.0)


def test_parse_page_size_mm_defaults_a_standard_size_to_landscape():
    assert kicad_import.parse_page_size_mm('(paper "A4")') == (297.0, 210.0)


def test_parse_page_size_mm_honors_an_explicit_portrait_keyword():
    assert kicad_import.parse_page_size_mm('(paper "A4" portrait)') == (210.0, 297.0)


def test_parse_page_size_mm_falls_back_when_no_paper_directive_is_present():
    assert kicad_import.parse_page_size_mm("(kicad_sch (version 1))") == kicad_import.DEFAULT_PAGE_SIZE_MM


def test_parse_page_size_mm_reads_a_us_standard_size():
    # Regression test: reverse_polarity_08 (a real imported board) declares
    # "(paper "USLetter" portrait)" -- missing from STANDARD_PAPER_SIZES_MM
    # entirely until this device surfaced it, which silently fell back to
    # DEFAULT_PAGE_SIZE_MM (100x110mm, wildly wrong for an 8.5x11in sheet).
    assert kicad_import.parse_page_size_mm('(paper "USLetter" portrait)') == pytest.approx((215.9, 279.4))
    assert kicad_import.parse_page_size_mm('(paper "USLetter")') == pytest.approx((279.4, 215.9))


@requires_kicad
def test_import_probe_geometry_resolves_every_wire_segment_to_its_real_net():
    geo = kicad_import.import_probe_geometry("voltage_divider_01")
    assert len(geo["wires"]) > 0
    for wire in geo["wires"]:
        assert wire["node"] in {"VIN", "VOUT", "0"}
    # a specific, known segment: the VIN rail between V1 and R1
    assert any(
        w["node"] == "VIN" and w["x1_mm"] == pytest.approx(10.16) and w["x2_mm"] == pytest.approx(30.48)
        for w in geo["wires"]
    )


def test_resolve_all_pin_nets_covers_every_ref_not_just_testpoints():
    xml = """<?xml version="1.0"?>
    <export>
      <nets>
        <net code="1" name="/VIN"><node ref="TP1" pin="1"/><node ref="R1" pin="1"/></net>
        <net code="2" name="GND"><node ref="TP3" pin="1"/><node ref="V1" pin="2"/></net>
      </nets>
    </export>"""
    nets = kicad_import.resolve_all_pin_nets(xml)
    assert nets == {
        ("TP1", "1"): "VIN",
        ("R1", "1"): "VIN",
        ("TP3", "1"): "0",
        ("V1", "2"): "0",
    }


def test_resolve_all_pin_nets_sanitizes_parens_in_auto_generated_net_names():
    # KiCad auto-names an unlabeled net "Net-(REF-PIN)" -- common on a real
    # imported board where not every net is hand-labeled. Bare parens break
    # ngspice's tokenizer (it treats "(" as a controlled-source node-group),
    # so they must come out sanitized, matching kicad-cli's own SPICE
    # exporter's fix for the identical problem.
    xml = """<?xml version="1.0"?>
    <export>
      <nets>
        <net code="1" name="Net-(D1-A)"><node ref="D1" pin="2"/></net>
      </nets>
    </export>"""
    nets = kicad_import.resolve_all_pin_nets(xml)
    assert nets == {("D1", "2"): "Net__D1_A_"}


def test_resolve_all_pin_nets_sanitizes_a_leading_plus_in_a_real_net_label():
    # A real board's own net label ("+VE") isn't ngspice-unsafe like a bare
    # paren, but spice_runner.py's NODE_VOLTAGE_RE requires a node name to
    # start with a letter or underscore -- a raw "+VE" node's voltage would
    # be silently never captured from ngspice's `print all` output, so
    # /measure would report 0V for a real, live node instead of erroring.
    xml = """<?xml version="1.0"?>
    <export>
      <nets>
        <net code="1" name="/+VE"><node ref="R1" pin="1"/></net>
      </nets>
    </export>"""
    nets = kicad_import.resolve_all_pin_nets(xml)
    assert nets == {("R1", "1"): "_VE"}


def test_parse_lib_pin_offsets_reads_real_device_symbol_geometry():
    sch_text = """(kicad_sch
\t(lib_symbols
\t\t(symbol "Device:R"
\t\t\t(symbol "R_1_1"
\t\t\t\t(pin passive line
\t\t\t\t\t(at 0 3.81 270)
\t\t\t\t\t(length 1.27)
\t\t\t\t\t(name "~" (effects (font (size 1.27 1.27))))
\t\t\t\t\t(number "1" (effects (font (size 1.27 1.27))))
\t\t\t\t)
\t\t\t\t(pin passive line
\t\t\t\t\t(at 0 -3.81 90)
\t\t\t\t\t(length 1.27)
\t\t\t\t\t(name "~" (effects (font (size 1.27 1.27))))
\t\t\t\t\t(number "2" (effects (font (size 1.27 1.27))))
\t\t\t\t)
\t\t\t)
\t\t)
\t)
)
"""
    offsets = kicad_import.parse_lib_pin_offsets(sch_text)
    assert offsets == {"Device:R": {"1": (0.0, 3.81), "2": (0.0, -3.81)}}


def test_parse_all_symbol_instances_includes_every_component_not_just_tp():
    sch_text = """(kicad_sch
\t(lib_symbols
\t\t(symbol "Connector:TestPoint"
\t\t\t(property "Reference" "TP" (at 999 999 0))
\t\t)
\t)
\t(symbol
\t\t(lib_id "Device:R")
\t\t(at 30.48 35.56 0)
\t\t(property "Reference" "R1" (at 1 2 0))
\t)
\t(symbol
\t\t(lib_id "Connector:TestPoint")
\t\t(at 101.6 81.28 0)
\t\t(property "Reference" "TP1" (at 101.6 88.138 0))
\t)
)
"""
    instances = kicad_import.parse_all_symbol_instances(sch_text)
    by_ref = {i["ref"]: i for i in instances}
    assert set(by_ref) == {"R1", "TP1"}
    assert by_ref["R1"] == {"ref": "R1", "lib_id": "Device:R", "x": 30.48, "y": 35.56, "rotation": 0.0}


def test_parse_wires_extracts_both_endpoints():
    sch_text = """(kicad_sch
\t(wire
\t\t(pts (xy 10.16 39.37) (xy 30.48 39.37))
\t\t(stroke (width 0) (type default))
\t\t(uuid "abc")
\t)
)
"""
    wires = kicad_import.parse_wires(sch_text)
    assert wires == [((10.16, 39.37), (30.48, 39.37))]


def test_resolve_wire_nets_propagates_through_a_multi_segment_chain():
    # A-B and B-C are two separate wire segments sharing point B -- the net
    # at the far end (C, no pin there) must resolve via the *chain* through
    # B, not by proximity to A or B individually.
    a, b, c = (0.0, 0.0), (10.0, 0.0), (20.0, 0.0)
    wires = [(a, b), (b, c)]
    pin_positions = {a: "VIN"}
    segments = kicad_import.resolve_wire_nets(wires, pin_positions)
    assert {tuple(s.items()) for s in segments} == {
        tuple({"node": "VIN", "x1_mm": a[0], "y1_mm": a[1], "x2_mm": b[0], "y2_mm": b[1]}.items()),
        tuple({"node": "VIN", "x1_mm": b[0], "y1_mm": b[1], "x2_mm": c[0], "y2_mm": c[1]}.items()),
    }


def test_resolve_wire_nets_keeps_disconnected_nets_separate():
    # two entirely separate wire runs, each anchored by its own pin -- must
    # not bleed into each other just because both exist in the same file
    a, b = (0.0, 0.0), (10.0, 0.0)
    c, d = (100.0, 100.0), (110.0, 100.0)
    wires = [(a, b), (c, d)]
    pin_positions = {a: "VIN", c: "GND"}
    segments = kicad_import.resolve_wire_nets(wires, pin_positions)
    nodes_by_segment = {(s["x1_mm"], s["y1_mm"]): s["node"] for s in segments}
    assert nodes_by_segment[a] == "VIN"
    assert nodes_by_segment[c] == "GND"


def test_resolve_wire_nets_drops_a_wire_with_no_pin_anywhere_in_its_chain():
    # a stray wire with no component pin touching it anywhere in its
    # connected region has no way to know its net -- it must be omitted,
    # not guessed at from whatever's nearby
    wires = [((0.0, 0.0), (10.0, 0.0))]
    segments = kicad_import.resolve_wire_nets(wires, pin_positions={})
    assert segments == []
