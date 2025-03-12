"""设备模型测试"""

import sys
import os
from pathlib import Path
import pytest

# 添加项目根目录到Python路径
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from devices import Device, DeviceStatus


def test_device_creation():
    """测试设备创建"""
    device = Device(
        device_id="test-device-001",
        name="测试设备",
        device_type="sensor"
    )
    
    assert device.device_id == "test-device-001"
    assert device.name == "测试设备"
    assert device.device_type == "sensor"
    assert device.status == DeviceStatus.UNKNOWN
    assert device.properties == {}


def test_device_status():
    """测试设备状态设置和获取"""
    device = Device(
        device_id="test-device-002",
        name="测试设备2",
        device_type="switch"
    )
    
    device.set_status(DeviceStatus.ONLINE)
    assert device.get_status() == DeviceStatus.ONLINE
    
    device.set_status(DeviceStatus.ERROR)
    assert device.get_status() == DeviceStatus.ERROR


def test_device_properties():
    """测试设备属性设置和获取"""
    device = Device(
        device_id="test-device-003",
        name="测试设备3",
        device_type="thermostat"
    )
    
    # 测试初始状态
    assert device.get_property("temperature") is None
    
    # 设置属性
    device.set_property("temperature", 25.5)
    device.set_property("humidity", 60)
    
    # 验证属性值
    assert device.get_property("temperature") == 25.5
    assert device.get_property("humidity") == 60
    assert device.get_property("non_existent") is None


def test_device_to_dict():
    """测试设备转换为字典"""
    device = Device(
        device_id="test-device-004",
        name="测试设备4",
        device_type="camera"
    )
    
    device.set_status(DeviceStatus.ONLINE)
    device.set_property("resolution", "1080p")
    
    device_dict = device.to_dict()
    
    assert device_dict["device_id"] == "test-device-004"
    assert device_dict["name"] == "测试设备4"
    assert device_dict["type"] == "camera"
    assert device_dict["status"] == DeviceStatus.ONLINE
    assert device_dict["properties"] == {"resolution": "1080p"} 