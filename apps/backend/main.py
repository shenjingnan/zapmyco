from fastapi import FastAPI, WebSocket
from api import router, devices_router
from db import Base, engine
from starlette.websockets import WebSocketDisconnect

app = FastAPI()

# 创建数据库表
Base.metadata.create_all(bind=engine)

# 注册路由
app.include_router(router)
app.include_router(devices_router)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            print(f"收到消息: {data}")  # 添加日志输出
            await websocket.send_text(f"服务器收到消息: {data}")
    except WebSocketDisconnect:
        print("客户端断开连接")  # 添加日志输出
    except Exception as e:
        print(f"发生错误: {str(e)}")  # 添加日志输出
        await websocket.close()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
