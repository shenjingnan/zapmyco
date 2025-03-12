# Docker 构建与部署指南

本项目使用Docker实现前后端一体化部署，通过GitHub Actions自动验证Dockerfile的正确性。

## 项目结构

- 前端：基于React的Web应用，位于`apps/frontend`目录
- 后端：基于FastAPI的Python应用，位于`apps/backend`目录
- Docker：使用多阶段构建，将前后端集成到一个容器中

## Docker镜像构建

### 本地构建

```bash
# 构建镜像
docker build -t building-os:latest .

# 运行容器
docker run -p 80:80 -p 8000:8000 building-os:latest
```

### 镜像说明

- 前端通过80端口访问
- 后端API通过8000端口直接访问，也可通过80端口的`/api`路径访问
- 使用Caddy作为Web服务器，提供前端静态文件服务和后端API代理

## CI/CD 工作流

项目包含GitHub Actions工作流，用于自动验证Dockerfile的正确性：

### 触发条件

- 当推送到`main`、`develop`或`feature/*`分支时
- 当创建针对`main`或`develop`分支的Pull Request时
- 当修改以下文件时触发：
  - `Dockerfile`
  - `.github/workflows/docker-build.yml`
  - `apps/backend/**`
  - `apps/frontend/**`
  - `package.json`
  - `pnpm-lock.yaml`

### 工作流程

1. **前端测试**：运行前端单元测试
2. **后端测试**：运行后端单元测试
3. **Docker构建测试**：
   - 构建Docker镜像
   - 启动容器
   - 验证前端和后端服务是否正常响应
4. **安全扫描**：
   - 使用Trivy扫描安全漏洞
   - 使用Hadolint检查Dockerfile最佳实践
5. **多平台构建测试**：验证在不同CPU架构上的构建

## 本地开发

### 前端开发

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev
```

### 后端开发

```bash
# 进入后端目录
cd apps/backend

# 安装依赖
pip install -e .

# 启动开发服务器
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## 生产部署

### 使用Docker Compose（推荐）

创建`docker-compose.yml`文件：

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "80:80"
      - "8000:8000"
    restart: unless-stopped
    # 可选：添加环境变量
    environment:
      - NODE_ENV=production
      - PYTHONPATH=/app
```

启动服务：

```bash
docker-compose up -d
```

### 使用Kubernetes

提供了基本的Kubernetes部署配置在`k8s`目录中。

## 故障排除

### 常见问题

1. **前端无法访问后端API**
   - 确保前端API请求使用相对路径（如`/api/...`）
   - 检查Caddy配置中的代理路径是否正确

2. **容器启动失败**
   - 查看容器日志：`docker logs <container_id>`
   - 检查端口是否被占用

3. **CI构建失败**
   - 检查GitHub Actions日志，查看具体失败原因
   - 本地构建测试，确保Dockerfile在本地环境中正常工作

## 贡献指南

1. Fork本仓库
2. 创建功能分支：`git checkout -b feature/your-feature-name`
3. 提交更改：`git commit -m 'Add some feature'`
4. 推送到分支：`git push origin feature/your-feature-name`
5. 提交Pull Request

## 许可证

[MIT](LICENSE) 