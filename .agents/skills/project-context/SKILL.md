---
name: project-context
description: 帮助 AI 助手理解项目上下文和结构
---

# Project Context Skill

帮助 AI 助手理解项目上下文和结构。

## 项目概述

**ai-typescript-starter** (zapmyco) 是一个 AI 原生的 TypeScript 启动模板，专为 AI
辅助开发时代打造。\
基于 **Deno 2.x** 运行时，发布到 **JSR** 和 **npm**。

## 技术栈

| 技术       | 版本   | 用途                                            |
| ---------- | ------ | ----------------------------------------------- |
| Deno       | 2.8+   | 运行时 / TypeScript 编译 / 测试 / Lint / Format |
| TypeScript | 原生   | 编程语言                                        |
| cspell     | 8.x    | 拼写检查 (npm)                                  |
| dnt        | 0.42.x | Deno → npm 转换 (JSR)                           |
| JSR        | —      | 包发布 registry (zapmyco)                       |
| npm        | —      | 包发布 registry (zapmyco)                       |

## 目录结构

```
zapmyco/
├── .agents/          # Claude Code 配置
│   └── skills/       # 技能定义
├── .github/          # GitHub 配置
│   └── workflows/    # CI/CD 工作流
├── docs/             # 文档
├── examples/         # 示例代码
├── src/              # 源代码（与测试文件同目录，`*_test.ts`）
├── dist/             # npm 构建产物（dnt 输出）
├── tools/            # 构建/发布脚本
├── deno.json         # 项目配置
├── cspell.json       # 拼写检查配置
└── [其他配置文件]
```

## 可用脚本

| 命令                      | 说明                           |
| ------------------------- | ------------------------------ |
| `deno task dev`           | 开发模式 (watch)               |
| `deno task test`          | 运行测试                       |
| `deno task test:coverage` | 运行测试并收集覆盖率           |
| `deno task lint`          | 代码检查                       |
| `deno task check`         | 类型检查                       |
| `deno task check:all`     | 完整检查 (fmt+lint+check+test) |
| `deno task release`       | 自动化发布                     |
| `deno task build:npm`     | dnt 构建 npm 包                |

## 代码风格

由 `deno fmt` 和 `deno lint` 强制执行，配置在 `deno.json` 中：

- 2 空格缩进
- 单引号
- 必须有分号
- 行宽 100 字符
- 严格模式
- 禁止 `any` 类型（warn）

## 测试规范

- 测试文件放在 `src/*_test.ts`（与源码同目录）
- 使用 Deno 原生测试 API + `@std/assert`
- 使用 `Deno.test()` 和 `t.step()` 组织测试
