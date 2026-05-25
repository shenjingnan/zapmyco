# zapmyco

<p align="center">
  <img src="docs/public/logo.svg" alt="zapmyco logo" width="300" />
</p>

[![CI](https://github.com/shenjingnan/zapmyco/actions/workflows/ci.yml/badge.svg)](https://github.com/shenjingnan/zapmyco/actions/workflows/ci.yml)
[![Codecov](https://codecov.io/gh/shenjingnan/zapmyco/branch/main/graph/badge.svg)](https://codecov.io/gh/shenjingnan/zapmyco)
[![NPM](https://img.shields.io/npm/v/zapmyco.svg?color=brightgreen)](https://www.npmjs.com/package/zapmyco)
[![JSR](https://jsr.io/badges/@zapmyco/zapmyco)](https://jsr.io/@zapmyco/zapmyco)
[![License: MIT](https://img.shields.io/badge/License-MIT-brightgreen.svg)](https://opensource.org/licenses/MIT)

基于 Deno 的 AI 驱动命令行工具。

## 安装方式

### 二进制下载（无需安装运行时）

每个版本都会发布预编译的二进制文件，一行命令即可安装：

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/shenjingnan/zapmyco/main/install.sh | sh

# Windows (PowerShell)
iwr https://raw.githubusercontent.com/shenjingnan/zapmyco/main/install.ps1 -useb | iex
```

安装脚本支持通过环境变量指定版本和安装目录：

```bash
# 安装指定版本
ZAPMYCO_VERSION=vX.X.X curl -fsSL https://raw.githubusercontent.com/shenjingnan/zapmyco/main/install.sh | sh

# 安装到自定义目录
ZAPMYCO_INSTALL=~/tools curl -fsSL https://raw.githubusercontent.com/shenjingnan/zapmyco/main/install.sh | sh
```

如果你更倾向于直接下载二进制文件，也可以从下表选择对应平台：

| 平台    | 架构          | 下载链接                                                                                                           |
| ------- | ------------- | ------------------------------------------------------------------------------------------------------------------ |
| Linux   | x86_64        | [zapmyco-linux-x64](https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-linux-x64)             |
| Linux   | ARM64         | [zapmyco-linux-arm64](https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-linux-arm64)         |
| macOS   | Apple Silicon | [zapmyco-macos-arm64](https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-macos-arm64)         |
| macOS   | Intel         | [zapmyco-macos-x64](https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-macos-x64)             |
| Windows | x86_64        | [zapmyco-windows-x64.exe](https://github.com/shenjingnan/zapmyco/releases/latest/download/zapmyco-windows-x64.exe) |

### 通过 npm 安装

```bash
npx zapmyco --help
```

### 通过 JSR / Deno 运行

```bash
deno run --allow-env --allow-net jsr:@zapmyco/zapmyco --help
```

## 特性

- **现代技术栈**: TypeScript + Deno 2.x 运行时
- **测试框架**: Deno Test - 内置测试运行器
- **代码质量**: deno lint + deno fmt + cspell (拼写检查)
- **AI 集成**: 内置 CLAUDE.md 和 .claude/ 目录配置
- **CI/CD**: GitHub Actions 自动化测试和发布
- **双平台发布**: 自动发布到 JSR 和 npm (通过 dnt)

## 快速开始

### 使用模板

点击仓库页面的 "Use this template" 按钮创建新项目。

### 安装

```bash
# 克隆项目
git clone https://github.com/your-username/your-project.git
cd your-project
```

> 本项目基于 Deno 运行时，无需手动安装依赖。Deno 会自动处理模块缓存。

### 开发

```bash
# 开发模式
deno task dev

# 测试
deno task test

# 代码检查
deno task lint

# 类型检查
deno task check

# 完整检查
deno task check:all
```

## 项目结构

```
ai-typescript-starter/
├── .claude/              # Claude Code 配置
│   ├── skills/           # 技能定义
│   └── CLAUDE.md         # 项目上下文
├── .github/              # GitHub 配置
│   └── workflows/        # CI/CD 工作流
├── docs/                 # 文档
├── examples/             # 示例代码
├── src/                  # 源代码
│   ├── index.ts          # 主入口 & CLI
│   ├── index_test.ts     # 测试文件（与源码同目录）
│   ├── ai-agent.ts       # AI Agent 对话模块
│   └── text-line-stream.ts # 文本行流工具
├── tools/                # 构建/发布脚本
│   ├── build-npm.ts      # dnt npm 构建
│   └── release.ts        # 自动化发布
├── AGENTS.md             # AI Agent 配置
├── deno.json             # Deno 配置
└── dist/                 # 构建产物
```

## 可用脚本

| 命令                      | 说明                                 |
| ------------------------- | ------------------------------------ |
| `deno task dev`           | 开发模式 (watch)                     |
| `deno task test`          | 运行测试                             |
| `deno task test:coverage` | 测试覆盖率报告                       |
| `deno task lint`          | 代码检查                             |
| `deno task fmt`           | 格式化代码                           |
| `deno task fmt:check`     | 格式检查                             |
| `deno task check`         | 类型检查                             |
| `deno task check:all`     | 完整检查 (fmt + lint + check + test) |
| `deno task cli`           | 运行 CLI                             |
| `deno task ai`            | AI 对话模式                          |
| `deno task release`       | 创建发布                             |
| `deno task release:dry`   | 发布干运行 (不实际发布)              |
| `deno task build:npm`     | dnt 构建 npm 包                      |

## AI 辅助开发

本项目专为 AI 辅助开发设计，内置了完善的 AI 工程约束：

### CLAUDE.md

为 Claude Code 提供项目上下文和开发规范。

### .claude/ 目录

- `skills/` - 项目技能定义 (`update-readme`, `resolve-git-conflicts` 等)
- `CLAUDE.md` - 项目上下文和开发规范

Slash 命令通过内置 skills 提供，支持 `/build`, `/test`, `/lint`, `/typecheck`, `/spellcheck`,
`/release`, `/commit-push-pr` 等。

## 贡献指南

请参阅 [贡献指南](https://zapmyco-docs.vercel.app/community/contributing)
了解代码风格、测试规范、提交规范和发布流程等详细内容。

## 文档

请访问 [文档站点](https://zapmyco-docs.vercel.app) 查看完整的在线文档，包括：

- [快速开始](https://zapmyco-docs.vercel.app/quickstart)
- [CLI 使用指南](https://zapmyco-docs.vercel.app/guide/cli-usage)
- [AI 代理功能](https://zapmyco-docs.vercel.app/guide/ai-agent)
- [架构说明](https://zapmyco-docs.vercel.app/advanced/architecture)
- [发布流程](https://zapmyco-docs.vercel.app/advanced/release-flow)
- [贡献指南](https://zapmyco-docs.vercel.app/community/contributing)

## 许可证

[MIT](LICENSE) © 2026 shenjingnan
