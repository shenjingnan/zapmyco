# zapmyco

<p align="right">
  <a href="README.en.md">English</a> | <strong>中文</strong>
</p>

<p align="center">
  <img src="docs/public/logo.svg" alt="zapmyco logo" width="300" />
</p>

<p align="center">
  <a href="https://github.com/shenjingnan/zapmyco/actions/workflows/ci.yml"><img src="https://github.com/shenjingnan/zapmyco/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/shenjingnan/zapmyco"><img src="https://img.shields.io/codecov/c/github/shenjingnan/zapmyco" alt="Codecov"></a>
  <a href="https://crates.io/crates/zapmyco"><img src="https://img.shields.io/crates/v/zapmyco.svg?color=brightgreen" alt="crates.io"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-brightgreen.svg" alt="License: MIT"></a>
</p>

基于 Rust 的多供应商 AI 命令行工具，内置 60+ 模型，支持 Anthropic API 兼容的云端与本地推理框架。

## 安装方式

### 一键安装脚本（推荐）

**macOS / Linux**

```bash
curl -fsSL https://zapmyco.com/install.sh | sh
```

**Windows (PowerShell)**

在 PowerShell 中（推荐）:

```powershell
irm https://zapmyco.com/install.ps1 | iex
```

在 cmd.exe 中:

```powershell
powershell -c "irm https://zapmyco.com/install.ps1 | iex"
```

安装脚本会自动检测平台、下载对应二进制归档、验证完整性，并配置 PATH。

### 手动下载

从 [GitHub Releases](https://github.com/shenjingnan/zapmyco/releases/latest) 下载对应平台的压缩包，解压后将 `zapmyco`（或 `zapmyco.exe`）放入 `PATH` 环境变量中的目录即可。

| 平台    | 架构          | 下载链接                                                                                                                             |
| ------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Linux   | x86_64        | [zapmyco-x86_64-unknown-linux-gnu.tar.xz](https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-x86_64-unknown-linux-gnu.tar.xz) |
| Linux   | ARM64         | [zapmyco-aarch64-unknown-linux-gnu.tar.xz](https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-aarch64-unknown-linux-gnu.tar.xz) |
| macOS   | Apple Silicon | [zapmyco-aarch64-apple-darwin.tar.xz](https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-aarch64-apple-darwin.tar.xz) |
| macOS   | Intel         | [zapmyco-x86_64-apple-darwin.tar.xz](https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-x86_64-apple-darwin.tar.xz) |
| Windows | x86_64        | [zapmyco-x86_64-pc-windows-msvc.zip](https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-x86_64-pc-windows-msvc.zip) |

## 快速开始

### 1. 初始化配置

```bash
zapmyco init
```

交互式向导会引导你完成：

- 选择 AI 供应商（Anthropic / DeepSeek / Qwen / MiniMax / GLM / Kimi / Doubao / MIMO / 自定义）
- 配置 API Key（直接输入或使用环境变量）
- 选择默认模型

### 2. 使用

```bash
# 一次性 AI 任务
zapmyco run "用中文介绍 Rust 语言的特点"

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

- **Rust 实现**: 单二进制文件（~5-10MB），零运行时依赖，毫秒级启动，无需 Node.js 或 Python 运行时
- **多供应商 64+ 模型**: 内置 DeepSeek、Anthropic、Qwen、MiniMax、GLM、Kimi、Doubao、MIMO 等主流供应商，覆盖旗舰、开源、视觉模型
- **本地模型支持**: 通过自定义 `baseUrl` 接入 Ollama、llama.cpp、LM Studio、vLLM 等推理框架
- **聚合平台支持**: 兼容 OpenRouter（400+ 模型）、SiliconFlow（200+ 模型）
- **灵活的自定义配置**: 任何 Anthropic API 兼容的服务均可通过 `settings.toml` 配置，支持 `${env.VAR}` 语法引用环境变量

## 命令参考

| 命令 | 说明 |
|------|------|
| `zapmyco` | 查看帮助信息（等同于 `zapmyco --help`） |
| `zapmyco run <prompt>` | 一次性执行 AI 任务 |
| `zapmyco note add [content]` | 快速记录笔记（灵感/待办/想法），留空则交互式编辑 |
| `zapmyco init` | 交互式初始化向导 |
| `zapmyco settings` | 显示 LLM 配置（API Key 自动脱敏） |
| `zapmyco settings path` | 显示配置文件路径 |
| `zapmyco uninstall` | 卸载 zapmyco（清理配置、收据、二进制文件） |
| `zapmyco config` | 显示应用配置 |
| `zapmyco --help` | 显示帮助信息 |
| `zapmyco --version` | 显示版本号 |

## Shell 自动补全

zapmyco 支持为 Bash、Zsh、Fish 和 PowerShell 生成 shell 补全脚本，按 Tab 即可自动补全子命令和参数：

```bash
# Bash（添加到 ~/.bashrc）
eval "$(zapmyco completion bash)"

# Zsh（添加到 ~/.zshrc）
eval "$(zapmyco completion zsh)"

# Fish
zapmyco completion fish | source

# PowerShell（添加到 $PROFILE）
zapmyco completion powershell | Out-String | Invoke-Expression
```

启用后，输入 `zapmyco` 然后按 Tab 即可看到所有可用子命令。

## 内置模型

ZapMyCo 内置了 **8 个供应商共 64 个模型**，以下是各供应商的旗舰模型，完整列表请参阅 [内置模型文档](https://docs.zapmyco.com/guide/models)：

| 模型 | 供应商 | 上下文窗口 |
|------|--------|-----------|
| deepseek-v4-flash (推荐) | DeepSeek | 1M tokens |
| deepseek-v4-pro | DeepSeek | 1M tokens |
| claude-opus-4-8 | Anthropic | 1M tokens |
| claude-sonnet-4-6 | Anthropic | 1M tokens |
| qwen3.7-max | Qwen（通义千问） | 1M tokens |
| qwen3.7-plus | Qwen（通义千问） | 1M tokens（支持视觉） |
| MiniMax-M3 | MiniMax | 1M tokens（支持视觉） |
| MiniMax-M2.7 | MiniMax | 204.8K tokens |
| glm-5.1 | GLM（智谱） | 200K tokens |
| glm-5v-turbo | GLM（智谱） | 200K tokens（支持视觉） |
| kimi-for-coding | Kimi（月之暗面） | 256K tokens（支持视觉） |
| kimi-k2.6 | Kimi（月之暗面） | 256K tokens（支持视觉） |
| doubao-seed-2-0-pro | Doubao（火山引擎） | 256K tokens（支持视觉） |
| doubao-seed-2-0-lite | Doubao（火山引擎） | 256K tokens（支持视觉） |
| mimo-v2.5-pro | MIMO（小米） | 1M tokens |
| mimo-v2.5 | MIMO（小米） | 1M tokens（支持视觉） |

此外还支持：

- **本地模型** — 通过自定义 `baseUrl` 接入 Ollama、llama.cpp、LM Studio、vLLM 等推理框架
- **API 聚合平台** — 支持 OpenRouter（400+ 模型）、SiliconFlow（200+ 模型）
- **自定义供应商** — 任何 Anthropic API 兼容的服务均可通过 `settings.toml` 配置

## 贡献指南

请参阅 [贡献指南](https://docs.zapmyco.com/community/contributing) 了解如何参与项目开发和贡献代码。

## 许可证

[MIT](LICENSE) © 2026 shenjingnan
