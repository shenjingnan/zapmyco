#!/bin/bash
# 简化版启动脚本

# 切换到脚本所在目录
cd "$(dirname "$0")"

# 启动uvicorn服务器
echo "启动后端服务器..."
exec poetry run python -m main
