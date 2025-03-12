"""Pytest配置文件，提供测试所需的fixture"""

import sys
import os
from pathlib import Path
import pytest
import httpx
from httpx import ASGITransport
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from fastapi.testclient import TestClient
import asyncio
from contextlib import asynccontextmanager

# 添加项目根目录到Python路径
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from db import Base, get_db
from main import app


# 使用内存数据库进行测试
SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="function")
def db():
    """提供测试数据库会话"""
    # 创建数据库表
    Base.metadata.create_all(bind=engine)
    
    # 创建会话
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        # 清理数据库
        Base.metadata.drop_all(bind=engine)


# 使用pytest-asyncio插件
@pytest.fixture(scope="function")
async def async_client(db):
    """提供异步测试客户端"""
    # 覆盖依赖项
    def override_get_db():
        try:
            yield db
        finally:
            pass
    
    app.dependency_overrides[get_db] = override_get_db
    
    # 使用httpx.AsyncClient
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver"
    ) as client:
        yield client
    
    # 清理
    app.dependency_overrides.clear()


# 为了向后兼容，保留同步客户端fixture
@pytest.fixture(scope="function")
def client(db, request):
    """提供同步测试客户端"""
    # 覆盖依赖项
    def override_get_db():
        try:
            yield db
        finally:
            pass
    
    app.dependency_overrides[get_db] = override_get_db
    
    # 使用AsyncClient但在同步上下文中运行
    async def get_async_client():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver"
        ) as async_client:
            yield async_client
    
    # 创建一个事件循环并运行异步客户端
    loop = asyncio.new_event_loop()
    async_client_gen = get_async_client()
    async_client = loop.run_until_complete(async_client_gen.__anext__())
    
    # 创建一个同步包装器
    class SyncClientWrapper:
        def __init__(self, async_client):
            self.async_client = async_client
            self.loop = loop
        
        def get(self, url, **kwargs):
            return self.loop.run_until_complete(self.async_client.get(url, **kwargs))
        
        def post(self, url, **kwargs):
            return self.loop.run_until_complete(self.async_client.post(url, **kwargs))
        
        def put(self, url, **kwargs):
            return self.loop.run_until_complete(self.async_client.put(url, **kwargs))
        
        def delete(self, url, **kwargs):
            return self.loop.run_until_complete(self.async_client.delete(url, **kwargs))
        
        def patch(self, url, **kwargs):
            return self.loop.run_until_complete(self.async_client.patch(url, **kwargs))
    
    client = SyncClientWrapper(async_client)
    
    yield client
    
    # 清理
    app.dependency_overrides.clear()
    # 关闭异步客户端
    try:
        loop.run_until_complete(async_client_gen.__anext__())
    except StopAsyncIteration:
        pass
    loop.close() 