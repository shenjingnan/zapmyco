import uvicorn
import os
import sys

# 添加当前目录到 Python 路径，以便能够正确导入模块
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
