from fastapi import FastAPI
from api import router, devices_router
from db import Base, engine

# 创建数据库表
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="智能家居控制系统",
    description="一个用于控制智能家居和工业设备的 API",
    version="0.1.0",
)

# 包含API路由
app.include_router(router)
app.include_router(devices_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
