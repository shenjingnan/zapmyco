# zapmyco

<p align="center">
  <img src="docs/public/logo.svg" alt="zapmyco logo" width="300" />
</p>

<p align="center">
  <a href="https://github.com/shenjingnan/zapmyco/actions/workflows/ci.yml"><img src="https://github.com/shenjingnan/zapmyco/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://crates.io/crates/zapmyco"><img src="https://img.shields.io/crates/v/zapmyco.svg?color=brightgreen" alt="crates.io"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-brightgreen.svg" alt="License: MIT"></a>
</p>

基于 Rust 的 AI 驱动命令行工具，提供与 LLM 的交互式聊天体验。

## 安装方式

### 通过 cargo 安装

```bash
cargo install zapmyco
```

### 一键安装脚本（推荐，无需安装 Rust）

**macOS / Linux**

```bash
curl -fsSL https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-installer.sh | sh
```

**Windows (PowerShell)**

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-installer.ps1 | iex"
```

安装脚本会自动检测平台、下载对应二进制归档、验证完整性，并配置 PATH。

### 手动下载

每个版本都会发布预编译的二进制归档（`.tar.xz` / `.zip`）：

| 平台    | 架构          | 下载链接                                                                                                                             |
| ------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Linux   | x86_64        | [zapmyco-x86_64-unknown-linux-gnu.tar.xz](https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-x86_64-unknown-linux-gnu.tar.xz) |
| Linux   | ARM64         | [zapmyco-aarch64-unknown-linux-gnu.tar.xz](https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-aarch64-unknown-linux-gnu.tar.xz) |
| macOS   | Apple Silicon | [zapmyco-aarch64-apple-darwin.tar.xz](https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-aarch64-apple-darwin.tar.xz) |
| macOS   | Intel         | [zapmyco-x86_64-apple-darwin.tar.xz](https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-x86_64-apple-darwin.tar.xz) |
| Windows | x86_64        | [zapmyco-x86_64-pc-windows-msvc.zip](https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-x86_64-pc-windows-msvc.zip) |

### 从源码编译

```bash
git clone https://github.com/shenjingnan/zapmyco.git
cd zapmyco
cargo build --release
# 产物位于 target/release/zapmyco
```

## 快速开始

### 1. 初始化配置

```bash
zapmyco init
```

交互式向导会引导你完成：
- 选择 AI 供应商（DeepSeek / GLM / 自定义）
- 配置 API Key（直接输入或使用环境变量）
- 选择默认模型

### 2. 使用

```bash
# 一次性 AI 任务
zapmyco run "用中文介绍 Rust 语言的特点"

# 交互式对话模式
zapmyco

# 查看配置
zapmyco settings
zapmyco settings path
```

### 环境变量

```bash
# 直接设置 API Key
export DEEPSEEK_API_KEY=sk-your-key-here

# 或在 init 向导中选择使用环境变量引用
# 存储为 ${env.DEEPSEEK_API_KEY}
```

## 特性

- **Rust 实现**: 单二进制文件（~5-10MB），零运行时依赖，毫秒级启动
- **多供应商**: 内置 DeepSeek 和 GLM（智谱）模型支持，可自定义供应商
- **流式输出**: AI 回复实时逐字显示
- **交互式对话**: 支持 `/exit`、`/clear` 命令的终端聊天模式
- **配置管理**: 自动兼容旧版配置格式，支持 `${env.VAR}` 语法
- **CI/CD**: GitHub Actions 自动化测试和 5 平台交叉编译

## 命令参考

| 命令 | 说明 |
|------|------|
| `zapmyco` | 无参启动交互式对话模式 |
| `zapmyco run <prompt>` | 一次性执行 AI 任务 |
| `zapmyco init` | 交互式初始化向导 |
| `zapmyco settings` | 显示 LLM 配置（API Key 自动脱敏） |
| `zapmyco settings path` | 显示配置文件路径 |
| `zapmyco config` | 显示应用配置 |
| `zapmyco greet <name>` | 打招呼（示例命令） |
| `zapmyco --help` | 显示帮助信息 |
| `zapmyco --version` | 显示版本号 |

## 项目结构

```
zapmyco/
├── Cargo.toml              # Rust 项目配置和依赖管理
├── .github/workflows/
│   ├── ci.yml              # Rust CI（fmt + clippy + test + build）
│   ├── release.yml         # release-plz 自动版本发布（crates.io + git tag）[注: crates.io trusted publishing 要求此文件名]
│   └── dist.yml            # cargo-dist 多平台二进制构建 & GitHub Release（自动生成）
├── dist-workspace.toml     # cargo-dist 工作区配置（分发设置）
├── src/
│   ├── main.rs             # 二进制入口
│   ├── lib.rs              # 库入口
│   ├── cli.rs              # clap CLI 定义
│   ├── agent.rs            # AiAgent（Anthropic API 封装）
│   ├── models.rs           # 内置模型注册表
│   └── settings.rs         # ~/.zapmyco/settings.json 管理
├── tests/
│   └── integration_test.rs # 集成测试（wiremock）
└── AGENTS.md               # AI 辅助开发上下文
```

## 内置模型

| 模型 | 供应商 | 上下文窗口 |
|------|--------|-----------|
| deepseek-v4-flash | DeepSeek | 1M tokens |
| deepseek-v4-pro | DeepSeek | 1M tokens |
| deepseek-reasoner | DeepSeek | 128K tokens |
| glm-4-flash | GLM（智谱） | 128K tokens |
| glm-4v | GLM（智谱） | 128K tokens（支持视觉） |
| glm-5v-turbo | GLM（智谱） | 200K tokens（支持视觉） |
| glm-5.1 | GLM（智谱） | 200K tokens |

## 开发

```bash
# 构建
cargo build

# 测试（单线程避免环境变量竞争）
cargo test -- --test-threads=1

# 格式检查和 Lint
cargo fmt --check
cargo clippy -- -D warnings

# 完整检查
cargo fmt --check && cargo clippy -- -D warnings && cargo test -- --test-threads=1
```

## 技术栈

| 技术 | 用途 |
|------|------|
| Rust 1.95+ | 编程语言 |
| clap 4.x | CLI 参数解析 |
| anthropic-ai-sdk | Anthropic Messages API 客户端 |
| inquire | 交互式终端提示 |
| tokio | 异步运行时 |
| serde / serde_json | JSON 序列化 |

## 许可证

[MIT](LICENSE) © 2026 shenjingnan
