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
