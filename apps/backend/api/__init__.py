"""API 路由和处理程序模块"""

from .routes import router
from .devices import router as devices_router

__all__ = ["router", "devices_router"]
