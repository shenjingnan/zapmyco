# zapmyco

<p align="right">
  <strong>English</strong> | <a href="README.md">中文</a>
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

A Rust-based multi-vendor AI command-line tool with 60+ built-in models, supporting cloud and local inference frameworks compatible with the Anthropic API.

## Installation

### One-Click Install Script (Recommended)

**macOS / Linux**

```bash
curl -fsSL https://zapmyco.com/install.sh | sh
```

**Windows (PowerShell)**

In PowerShell (recommended):

```powershell
irm https://zapmyco.com/install.ps1 | iex
```

In cmd.exe:

```powershell
powershell -c "irm https://zapmyco.com/install.ps1 | iex"
```

The install script automatically detects your platform, downloads the correct binary archive, verifies its integrity, and configures PATH.

### Manual Download

Download the archive for your platform from the [GitHub Releases](https://github.com/shenjingnan/zapmyco/releases/latest) page, extract it, and place the `zapmyco` (or `zapmyco.exe`) binary in a directory listed in your `PATH`.

| Platform | Architecture | Download Link |
|----------|-------------|---------------|
| Linux | x86_64 | [zapmyco-x86_64-unknown-linux-gnu.tar.xz](https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-x86_64-unknown-linux-gnu.tar.xz) |
| Linux | ARM64 | [zapmyco-aarch64-unknown-linux-gnu.tar.xz](https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-aarch64-unknown-linux-gnu.tar.xz) |
| macOS | Apple Silicon | [zapmyco-aarch64-apple-darwin.tar.xz](https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-aarch64-apple-darwin.tar.xz) |
| macOS | Intel | [zapmyco-x86_64-apple-darwin.tar.xz](https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-x86_64-apple-darwin.tar.xz) |
| Windows | x86_64 | [zapmyco-x86_64-pc-windows-msvc.zip](https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-x86_64-pc-windows-msvc.zip) |

## Quick Start

### 1. Initialize Configuration

```bash
zapmyco init
```

The interactive wizard guides you through:

- Selecting an AI provider (Anthropic / DeepSeek / Qwen / MiniMax / GLM / Kimi / Doubao / MIMO / Custom)
- Configuring your API Key (enter directly or use environment variables)
- Choosing a default model

### 2. Usage

```bash
# One-shot AI task
zapmyco run "Explain the features of the Rust programming language"

# View configuration
zapmyco settings
zapmyco settings path
```

### Environment Variables

```bash
# Set API Key directly
export DEEPSEEK_API_KEY=sk-your-key-here

# Or reference an environment variable in the init wizard
# Stored as ${env.DEEPSEEK_API_KEY}
```

## Features

- **Rust-Powered**: Single binary (~5-10MB), zero runtime dependencies, millisecond startup — no Node.js or Python required
- **64+ Models from 8 Vendors**: Built-in support for DeepSeek, Anthropic, Qwen, MiniMax, GLM, Kimi, Doubao, MIMO, and more — covering flagship, open-source, and vision models
- **Local Model Support**: Connect to Ollama, llama.cpp, LM Studio, vLLM, and other inference frameworks via custom `baseUrl`
- **Aggregator Platform Support**: Compatible with OpenRouter (400+ models), SiliconFlow (200+ models)
- **Flexible Custom Configuration**: Any Anthropic API-compatible service can be configured via `settings.toml`, with `${env.VAR}` syntax for environment variable references

## Command Reference

| Command | Description |
|---------|-------------|
| `zapmyco` | Show help information (same as `zapmyco --help`) |
| `zapmyco run <prompt>` | Execute a one-shot AI task |
| `zapmyco note add [content]` | Quickly save a note (idea/todo/thought); leave blank for interactive editing |
| `zapmyco init` | Interactive initialization wizard |
| `zapmyco settings` | Display LLM configuration (API keys are automatically masked) |
| `zapmyco settings path` | Show configuration file path |
| `zapmyco uninstall` | Uninstall zapmyco (clean up config, receipts, and binary) |
| `zapmyco config` | Display application configuration |
| `zapmyco --help` | Show help information |
| `zapmyco --version` | Show version number |

## Shell Completion

zapmyco supports shell completion scripts for Bash, Zsh, Fish, and PowerShell. Press Tab to auto-complete subcommands and arguments:

```bash
# Bash (add to ~/.bashrc)
eval "$(zapmyco completion bash)"

# Zsh (add to ~/.zshrc)
eval "$(zapmyco completion zsh)"

# Fish
zapmyco completion fish | source

# PowerShell (add to $PROFILE)
zapmyco completion powershell | Out-String | Invoke-Expression
```

Once enabled, type `zapmyco` and press Tab to see all available subcommands.

## Built-in Models

ZapMyCo ships with **64 models from 8 vendors**. Below are the flagship models from each provider. For the full list, see the [built-in models documentation](https://docs.zapmyco.com/guide/models):

| Model | Vendor | Context Window |
|-------|--------|----------------|
| deepseek-v4-flash (Recommended) | DeepSeek | 1M tokens |
| deepseek-v4-pro | DeepSeek | 1M tokens |
| claude-opus-4-8 | Anthropic | 1M tokens |
| claude-sonnet-4-6 | Anthropic | 1M tokens |
| qwen3.7-max | Qwen | 1M tokens |
| qwen3.7-plus | Qwen | 1M tokens (vision) |
| MiniMax-M3 | MiniMax | 1M tokens (vision) |
| MiniMax-M2.7 | MiniMax | 204.8K tokens |
| glm-5.1 | GLM (Zhipu AI) | 200K tokens |
| glm-5v-turbo | GLM (Zhipu AI) | 200K tokens (vision) |
| kimi-for-coding | Kimi (Moonshot AI) | 256K tokens (vision) |
| kimi-k2.6 | Kimi (Moonshot AI) | 256K tokens (vision) |
| doubao-seed-2-0-pro | Doubao (Volcengine) | 256K tokens (vision) |
| doubao-seed-2-0-lite | Doubao (Volcengine) | 256K tokens (vision) |
| mimo-v2.5-pro | MIMO (Xiaomi) | 1M tokens |
| mimo-v2.5 | MIMO (Xiaomi) | 1M tokens (vision) |

Additional options:

- **Local Models** — Connect to Ollama, llama.cpp, LM Studio, vLLM, etc. via custom `baseUrl`
- **API Aggregators** — Supports OpenRouter (400+ models), SiliconFlow (200+ models)
- **Custom Providers** — Any Anthropic API-compatible service can be configured via `settings.toml`

## Contributing

Please refer to the [Contributing Guide](https://docs.zapmyco.com/community/contributing) for details on how to participate in project development and contribute code.

## License

[MIT](LICENSE) © 2026 shenjingnan
