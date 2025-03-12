"""API端点测试"""

import sys
import os
from pathlib import Path
import pytest

# 添加项目根目录到Python路径
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))


def test_root_endpoint(client):
    """测试根端点是否返回正确的欢迎消息"""
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"message": "欢迎使用智能家居控制系统"}


def test_health_check(client):
    """测试健康检查端点是否正常工作"""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"} 