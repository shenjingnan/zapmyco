# Building OS

## Introduction

Powered by AI

## Quick Start

```bash
npm install
```

## Run

```bash
npm run dev
```

## Build

```bash
npm run build
```

BentoUI style

## Setup

```bash
npm install
```

## Development Container

本项目支持使用 VS Code 的开发容器进行开发。开发容器提供了一个预配置的开发环境，包含所有必要的工具和依赖。

### 开发环境特点

- 基于 Python 3.12 和 Node.js 20
- 使用 uv 进行 Python 依赖管理（比传统的 pip 更快）
- 预装 pnpm 和 NX CLI 用于前端开发
- 自动配置虚拟环境

### 使用开发容器

1. 安装 [VS Code](https://code.visualstudio.com/) 和 [Remote - Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) 扩展
2. 克隆此仓库并在 VS Code 中打开
3. 当提示时，点击 "Reopen in Container"，或者使用命令面板 (F1) 运行 "Remote-Containers: Reopen in Container"

### 镜像源配置

为了支持全球开发者，开发容器默认使用官方镜像源。对于中国大陆的开发者，我们提供了自动检测网络环境并配置国内镜像源的脚本：

```bash
# 在项目根目录运行
chmod +x .devcontainer/setup-mirrors.sh
./.devcontainer/setup-mirrors.sh
```

运行此脚本后，重新构建开发容器以应用更改。

## Code Contribution
