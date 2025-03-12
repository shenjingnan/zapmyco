"""设备API端点测试"""

import sys
import os
from pathlib import Path
import pytest
from db import DeviceModel
from devices import DeviceStatus

# 添加项目根目录到Python路径
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))


def test_get_devices_empty(client, db):
    """测试获取设备列表 - 空列表"""
    response = client.get("/devices/")
    assert response.status_code == 200
    assert response.json() == []


def test_get_devices(client, db):
    """测试获取设备列表 - 有设备"""
    # 添加测试设备到数据库
    device = DeviceModel(
        device_id="test-device-1",
        name="测试设备1",
        device_type="sensor",
        status=DeviceStatus.ONLINE,
        properties={}
    )
    db.add(device)
    db.commit()
    
    response = client.get("/devices/")
    assert response.status_code == 200
    devices = response.json()
    assert len(devices) == 1
    assert devices[0]["device_id"] == "test-device-1"
    assert devices[0]["name"] == "测试设备1"
    assert devices[0]["type"] == "sensor"


def test_get_device(client, db):
    """测试获取单个设备"""
    # 添加测试设备到数据库
    device = DeviceModel(
        device_id="test-device-2",
        name="测试设备2",
        device_type="switch",
        status=DeviceStatus.ONLINE,
        properties={}
    )
    db.add(device)
    db.commit()
    
    response = client.get("/devices/test-device-2")
    assert response.status_code == 200
    device_data = response.json()
    assert device_data["device_id"] == "test-device-2"
    assert device_data["name"] == "测试设备2"
    assert device_data["type"] == "switch"


def test_get_device_not_found(client, db):
    """测试获取不存在的设备"""
    response = client.get("/devices/non-existent-device")
    assert response.status_code == 404
    assert "设备未找到" in response.json()["detail"]


def test_create_device(client, db):
    """测试创建设备"""
    device_data = {
        "device_id": "test-device-3",
        "name": "测试设备3",
        "type": "thermostat"
    }
    
    response = client.post("/devices/", json=device_data)
    assert response.status_code == 200
    created_device = response.json()
    assert created_device["device_id"] == "test-device-3"
    assert created_device["name"] == "测试设备3"
    assert created_device["type"] == "thermostat"
    
    # 验证设备已添加到数据库
    device_in_db = db.query(DeviceModel).filter(
        DeviceModel.device_id == "test-device-3").first()
    assert device_in_db is not None
    assert device_in_db.name == "测试设备3" 