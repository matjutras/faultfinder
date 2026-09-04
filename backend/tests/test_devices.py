import pytest

from app import devices


def test_load_device():
    device = devices.load_device("voltage_divider_01")
    assert device["id"] == "voltage_divider_01"
    assert device["schematic_sch"] == "voltage_divider_01.kicad_sch"


def test_load_map_has_three_testpoints():
    m = devices.load_map("voltage_divider_01")
    tp_ids = {tp["tp_id"] for tp in m["testpoints"]}
    assert tp_ids == {"TP1", "TP2", "TP3"}


def test_find_fault_healthy_has_empty_patch():
    fault = devices.find_fault("voltage_divider_01", "healthy")
    assert fault["patch"] == []


def test_find_fault_unknown_raises():
    with pytest.raises(ValueError):
        devices.find_fault("voltage_divider_01", "does_not_exist")


def test_unknown_device_raises():
    with pytest.raises(devices.DeviceNotFound):
        devices.load_device("nope")
