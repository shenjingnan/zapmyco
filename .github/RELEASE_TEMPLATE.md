## 📥 安装

### 一键安装（推荐）

**macOS / Linux**

```bash
curl -fsSL https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-installer.sh | sh
```

**Windows (PowerShell)**

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-installer.ps1 | iex"
```

### 通过 cargo 安装

需要安装 [Rust 工具链](https://rustup.rs)：

```bash
cargo install zapmyco
```

### 手动下载

本 Release 提供以下预编译二进制归档，下载解压后即可使用：

| 平台 | 架构 | 文件 |
|------|------|------|
| Linux | x86_64 | `zapmyco-x86_64-unknown-linux-gnu.tar.xz` |
| Linux | ARM64 | `zapmyco-aarch64-unknown-linux-gnu.tar.xz` |
| macOS | Apple Silicon | `zapmyco-aarch64-apple-darwin.tar.xz` |
| macOS | Intel | `zapmyco-x86_64-apple-darwin.tar.xz` |
| Windows | x86_64 | `zapmyco-x86_64-pc-windows-msvc.zip` |

完整性校验文件：`sha256.sum`

## 🚀 快速开始

```bash
# 1. 初始化配置（首次使用）
zapmyco init

# 2. 运行一次 AI 任务
zapmyco run "你的问题"

# 3. 启动交互式对话
zapmyco
```

### 环境变量方式（跳过 init）

```bash
export DEEPSEEK_API_KEY=sk-your-key-here
zapmyco run "你好"
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `zapmyco run <prompt>` | 一次性 AI 任务 |
| `zapmyco` | 交互式对话模式 |
| `zapmyco init` | 初始化 / 重新配置 |
| `zapmyco settings` | 查看当前配置 |
| `zapmyco --help` | 查看帮助 |

---

## 更新日志
