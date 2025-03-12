"""API 路由定义"""

from fastapi import APIRouter

router = APIRouter()


@router.get("/")
async def root():
    return {"message": "欢迎使用智能家居控制系统"}


@router.get("/health")
async def health_check():
    return {"status": "healthy"}
