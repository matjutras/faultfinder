from app import devices, fault_gen

CIRCUIT = devices.load_circuit("voltage_divider_01")


def test_generates_open_and_drift_faults_per_resistor():
    pool = fault_gen.generate_fault_pool(CIRCUIT)
    ids = {f["id"] for f in pool}
    assert {"r1_open", "r1_drift_high", "r1_drift_low", "r2_open", "r2_drift_high", "r2_drift_low"} <= ids


def test_sources_are_excluded_from_per_component_faults():
    pool = fault_gen.generate_fault_pool(CIRCUIT)
    assert not any(f["id"].startswith("v1_") for f in pool)


def test_exactly_one_fault_is_marked_intermittent():
    pool = fault_gen.generate_fault_pool(CIRCUIT)
    intermittent = [f for f in pool if f.get("intermittent")]
    assert len(intermittent) == 1
    assert intermittent[0]["kind"] == "component_failed"


def test_the_intermittent_fault_is_categorized_hard_not_easy():
    # Regression test: the intermittent fault is always per_component[0],
    # which for an R/L/D component is that component's "open circuit" fault
    # -- normally tagged "easy". A connection that only sometimes reads
    # faulted is genuinely harder to diagnose than a stable one, so it must
    # not stay in the "easy" tier just because its non-intermittent sibling
    # faults of the same kind are.
    pool = fault_gen.generate_fault_pool(CIRCUIT)
    intermittent = next(f for f in pool if f.get("intermittent"))
    assert intermittent["difficulty"] == "hard"


def test_net_pair_shorts_are_deduped_and_classified():
    pool = fault_gen.generate_fault_pool(CIRCUIT)
    shorts = [f for f in pool if f["kind"] in ("short_to_ground", "short_to_vcc", "short_between_nodes")]

    pairs = [frozenset(f["patch"][0]["between"]) for f in shorts]
    assert len(pairs) == len(set(pairs)), "duplicate net-pair short faults"

    kinds_by_pair = {frozenset(f["patch"][0]["between"]): f["kind"] for f in shorts}
    assert kinds_by_pair[frozenset({"VOUT", "0"})] == "short_to_ground"
    assert kinds_by_pair[frozenset({"VIN", "VOUT"})] == "short_to_vcc"


def test_source_to_ground_pairing_is_excluded_as_degenerate():
    # VIN (the source's own + terminal) shorted directly to "0" (its own
    # reference) doesn't perturb an ideal voltage source's DC operating point
    # at all -- verified against a real ngspice run, not assumed. Confirms the
    # fix stays in place: this specific pair must never be generated.
    pool = fault_gen.generate_fault_pool(CIRCUIT)
    pairs = [frozenset(f["patch"][0]["between"]) for f in pool if f["kind"].startswith("short")]
    assert frozenset({"VIN", "0"}) not in pairs


def test_parse_components_reads_source_nodes_despite_trailing_dc_directive():
    components = fault_gen.parse_components(CIRCUIT)
    v1 = next(c for c in components if c.ref == "V1")
    assert v1.nodes == ["VIN", "0"]
    assert v1.value is None


def test_generate_fault_pool_is_deterministic():
    assert fault_gen.generate_fault_pool(CIRCUIT) == fault_gen.generate_fault_pool(CIRCUIT)


MOSFET_CIRCUIT = """\
* discrete P-MOSFET reverse-polarity protection, minimal
V1 VIN 0 DC 9
R1 GATE 0 100k
M1 VIN GATE VOUT VOUT PMOSMOD
.model PMOSMOD PMOS
.end
"""


def test_parse_components_reads_all_four_mosfet_nodes_not_the_model_name():
    # Regression test: before the "M" case existed, parse_components fell
    # through to the generic branch and treated the trailing model name
    # ("PMOSMOD") as a 5th node -- which _net_pair_faults then turned into a
    # bogus short-to-model-name fault tying a real net to a phantom,
    # single-connection node ngspice can't solve.
    components = fault_gen.parse_components(MOSFET_CIRCUIT)
    m1 = next(c for c in components if c.ref == "M1")
    assert m1.nodes == ["VIN", "GATE", "VOUT", "VOUT"]
    assert m1.value is None
    assert not any("PMOSMOD" in f["patch"][0].get("between", []) for f in fault_gen.generate_fault_pool(MOSFET_CIRCUIT))


def test_mosfet_generates_drain_open_and_drain_source_leaky_short():
    # Not gate-open: verified against a real ngspice run on reverse_polarity_08
    # that a gate-open fault is a silent no-op when the healthy circuit already
    # biases the gate near ground through a resistor (an ideal MOSFET model
    # draws zero DC gate current either way) -- see fault_gen.py's own comment.
    pool = fault_gen.generate_fault_pool(MOSFET_CIRCUIT)
    ids = {f["id"] for f in pool}
    assert "m1_open" in ids
    assert "m1_leaky_short" in ids
    assert "m1_gate_open" not in ids

    drain_open = next(f for f in pool if f["id"] == "m1_open")
    assert drain_open["patch"] == [{"op": "open_pin", "ref": "M1", "pin": 1}]

    leaky = next(f for f in pool if f["id"] == "m1_leaky_short")
    assert leaky["patch"] == [{"op": "add_short", "between": ["VIN", "VOUT"], "resistance": "1k"}]
