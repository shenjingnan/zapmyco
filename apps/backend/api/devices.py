"""设备相关API路由"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict, Any

from db import get_db, DeviceModel
from devices import Device, DeviceStatus

router = APIRouter(prefix="/devices", tags=["devices"])


@router.get("/", response_model=List[Dict[str, Any]])
async def get_devices(db: Session = Depends(get_db)):
    """获取所有设备列表"""
    devices = db.query(DeviceModel).all()
    return [
        Device(
            device_id=device.device_id,
            name=device.name,
            device_type=device.device_type
        ).to_dict()
        for device in devices
    ]


@router.get("/{device_id}", response_model=Dict[str, Any])
async def get_device(device_id: str, db: Session = Depends(get_db)):
    """获取特定设备信息"""
    device = db.query(DeviceModel).filter(
        DeviceModel.device_id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="设备未找到")

    return Device(
        device_id=device.device_id,
        name=device.name,
        device_type=device.device_type
    ).to_dict()


@router.post("/", response_model=Dict[str, Any])
async def create_device(
    device_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """创建新设备"""
    device = DeviceModel(
        device_id=device_data["device_id"],
        name=device_data["name"],
        device_type=device_data["type"],
        status=DeviceStatus.OFFLINE,
        properties={}
    )
    db.add(device)
    db.commit()
    db.refresh(device)

    return Device(
        device_id=device.device_id,
        name=device.name,
        device_type=device.device_type
    ).to_dict()
