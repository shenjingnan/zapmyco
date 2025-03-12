"""设备基类定义"""

from enum import Enum
from typing import Optional, Dict, Any


class DeviceStatus(str, Enum):
    """设备状态枚举"""
    ONLINE = "online"
    OFFLINE = "offline"
    ERROR = "error"
    UNKNOWN = "unknown"


class Device:
    """智能设备基类"""

    def __init__(self, device_id: str, name: str, device_type: str):
        self.device_id = device_id
        self.name = name
        self.device_type = device_type
        self.status = DeviceStatus.UNKNOWN
        self.properties: Dict[str, Any] = {}

    def get_status(self) -> DeviceStatus:
        """获取设备状态"""
        return self.status

    def set_status(self, status: DeviceStatus) -> None:
        """设置设备状态"""
        self.status = status

    def get_property(self, property_name: str) -> Optional[Any]:
        """获取设备属性"""
        return self.properties.get(property_name)

    def set_property(self, property_name: str, value: Any) -> None:
        """设置设备属性"""
        self.properties[property_name] = value

    def to_dict(self) -> Dict[str, Any]:
        """将设备信息转换为字典"""
        return {
            "device_id": self.device_id,
            "name": self.name,
            "type": self.device_type,
            "status": self.status,
            "properties": self.properties
        }
