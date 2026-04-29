# zapmyco

[![CI](https://github.com/shenjingnan/zapmyco/actions/workflows/ci.yml/badge.svg)](https://github.com/shenjingnan/zapmyco/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/zapmyco.svg)](https://www.npmjs.com/package/zapmyco)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

AI 原生并行任务编排系统 -- AI 总管 (Personal AI Chief of Staff)。

## 特性

- **Agent 协议**: 统一的 `IAgent` / `IStreamingAgent` 接口，支持请求-响应 + 流式事件双通道模式
- **任务编排**: 目标分解、子任务依赖图、并行执行与结果聚合
- **Agent 运行时**: 基于 pi-agent-core 的适配层，支持 LLM 驱动的 Agent 创建与工具桥接
- **LLM 集成**: 多 Provider 抽象、结构化输出、Token 用量追踪
- **交互式 REPL**: 基于 pi-tui 的终端界面，支持命令注册、历史记录、自定义编辑器
- **CLI 工具链**: `run` 直接执行目标、`agents` 查看注册 Agent、`config` 管理配置
- **配置系统**: cosmiconfig 驱动，支持多级配置覆盖
- **基础设施**: 事件总线、统一错误体系、结构化日志

## 快速开始

### 安装

```bash
# 克隆项目
git clone https://github.com/shenjingnan/zapmyco.git
cd zapmyco

# 安装依赖
pnpm install
```

### 使用

```bash
# 构建项目
pnpm run build

# 进入交互式 REPL 模式
pnpm run start
# 或直接运行 CLI
zapmyco

# 直接执行单次目标（非交互模式）
zapmyco run "重构用户认证模块"

# 列出可用 Agent
zapmyco agents

# 显示版本号
zapmyco version
```

### 开发

```bash
# 开发模式 (watch)
pnpm run dev

# 测试
pnpm run test

# 代码检查
pnpm run lint

# 类型检查
pnpm run typecheck

# 完整检查
pnpm run check
```

## 项目结构

```
zapmyco/
├── .agents/              # AI Agent 配置 (.claude 符号链接指向此目录)
│   ├── commands/         # Slash 命令
│   └── skills/           # 技能定义
├── .github/              # GitHub 配置
│   └── workflows/        # CI/CD 工作流
├── docs/                 # 文档
├── examples/             # 示例代码
├── src/
│   ├── cli/              # CLI 入口 & REPL 交互界面
│   │   └── repl/         # REPL 核心：命令注册、会话、渲染、历史、编辑器
│   ├── config/           # 配置加载与默认值
│   ├── core/             # 核心领域模型
│   │   ├── agent-runtime/# Agent 运行时 (pi-agent-core 适配层)
│   │   ├── aggregator/   # 结果聚合
│   │   ├── intent/       # 目标与意图
│   │   ├── result/       # 任务结果
│   │   └── task/         # 子任务与依赖图
│   ├── infra/            # 基础设施：常量、错误、事件总线、日志
│   ├── llm/              # LLM Provider 抽象 & Token 追踪
│   ├── protocol/         # Agent 协议接口定义
│   └── __tests__/        # 测试文件
├── AGENTS.md             # AI Agent 配置
└── dist/                 # 构建产物
```

## 可用脚本

| 命令 | 说明 |
|------|------|
| `pnpm run build` | 构建项目 |
| `pnpm run dev` | 开发模式 (watch) |
| `pnpm run start` | 启动 CLI (REPL 模式) |
| `pnpm run test` | 运行测试 |
| `pnpm run test:watch` | 测试监听模式 |
| `pnpm run test:coverage` | 测试覆盖率报告 |
| `pnpm run lint` | 代码检查 |
| `pnpm run lint:fix` | 自动修复代码问题 |
| `pnpm run format` | 格式化代码 |
| `pnpm run typecheck` | TypeScript 类型检查 |
| `pnpm run check` | 完整检查 (typecheck + lint) |
| `pnpm run check:fix` | 检查并自动修复 |
| `pnpm run spellcheck` | 拼写检查 |
| `pnpm run release` | 创建发布 |
| `pnpm run release:beta` | 发布 beta 预发布版本 |
| `pnpm run release:dry` | 发布干运行 (不实际发布) |
| `pnpm run release:patch` | 直接发布 patch 版本 |
| `pnpm run release:minor` | 直接发布 minor 版本 |
| `pnpm run release:major` | 直接发布 major 版本 |

## 公共 API

### 核心导出

```typescript
import {
  VERSION,
  APP_NAME,
  // 配置
  loadConfig,
  DEFAULT_CONFIG,
  type ZapmycoConfig,
  // Agent 运行时
  createLlmBasedAgent,
  createToolsFromCapabilities,
  createToolFromCapability,
  adaptAgentEvent,
  createEventBridgeListener,
  dispatchToEventBus,
  LlmBasedAgent,
  // LLM
  CostTracker,
  costTracker,
  // 基础设施
  eventBus,
  Logger,
  logger,
  ZapmycoError,
} from 'zapmyco';
```

### Protocol 层类型

```typescript
import type {
  IAgent,
  IStreamingAgent,
  AgentExecuteRequest,
  AgentExecuteOptions,
  AgentStatus,
  Capability,
  CapabilityCategory,
  Goal,
  SubTask,
  TaskGraph,
  TaskResult,
  FinalResult,
  TokenUsage,
} from 'zapmyco';

// 或单独导入协议层
import type { IAgent, IStreamingAgent } from 'zapmyco/protocol';
```

### 核心领域类型

| 模块 | 关键类型 | 说明 |
|------|---------|------|
| `protocol/agent` | `IAgent`, `IStreamingAgent` | Agent 统一接口 |
| `core/intent` | `Goal`, `GoalType`, `GoalConstraints` | 目标与意图定义 |
| `core/task` | `SubTask`, `TaskGraph`, `TaskStatus` | 子任务与依赖图 |
| `core/result` | `TaskResult`, `FinalResult`, `TokenUsage` | 执行结果与用量 |
| `core/aggregator` | `ProgressEvent`, `ProgressPayload` | 进度事件 |
| `core/agent-runtime` | `AgentRuntimeConfig`, `ToolRegistration` | 运行时配置 |
| `llm/types` | `ChatMessage`, `LlmResponse`, `StructuredOutputSchema` | LLM 交互类型 |
| `config/types` | `ZapmycoConfig` | 应用配置 |

## AI 辅助开发

本项目专为 AI 辅助开发设计，内置了完善的 AI 工程约束：

### AGENTS.md / CLAUDE.md

为 Claude Code 提供项目上下文和开发规范。

### .agents/ 目录

- `commands/` - 自定义 Slash 命令 (`/build`, `/test`, `/lint`, `/typecheck`, `/release`, `/commit-push-pr`)
- `skills/` - 项目技能定义 (`update-readme`, `resolve-git-conflicts`, `project-context` 等)

## 代码风格

- 2 空格缩进
- 单引号
- 必须有分号
- 行宽 100 字符
- 禁止 `any` 类型 (warn)

## 测试规范

- 测试文件放在 `src/__tests__/` 目录
- 测试覆盖率阈值: 80%
- 使用 Vitest 全局 API

## 发布流程

本项目使用 [release-it](https://github.com/release-it/release-it) 进行版本管理：

```bash
pnpm run release
```

发布过程会自动：
1. 更新版本号
2. 更新 CHANGELOG.md
3. 创建 Git tag
4. 推送到远程仓库
5. 创建 GitHub Release

## 文档

- [架构文档](docs/architecture.md)
- [API 文档](docs/api.md)
- [贡献指南](docs/contributing.md)

## 许可证

[MIT](LICENSE) © 2026 shenjingnan
