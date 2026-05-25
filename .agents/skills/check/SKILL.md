---
name: check
description: 运行完整的代码质量检查（格式化、Lint、类型检查、测试、拼写检查）。当用户输入 /check、/lint、/test、/spellcheck、/typecheck 或要求代码检查、测试、类型检查、格式化、拼写检查时使用
---

# Check Command

运行完整的代码质量检查，包括格式化检查、Lint、类型检查、测试和拼写检查。

## 上下文获取

以下命令将在技能加载时自动执行，结果将注入到上下文中供分析：

- 全部检查结果: !`bash .agents/skills/check/scripts/run-checks.sh`

## 你的任务

根据上方注入的检查结果，按以下步骤处理：

### 1. 分析结果

逐项检查每个命令的输出，判断哪些检查未通过。

### 2. 修复问题

按以下优先级依次处理：

1. **格式化问题** — 运行 `deno fmt` 自动修复
2. **Lint 问题** — 分析 `deno lint` 输出并修复代码中的 lint 错误
3. **类型错误** — 分析 `deno check` 输出并修复类型错误
4. **测试失败** — 分析 `deno test` 输出并修复失败的测试
5. **拼写错误** — 修复拼写错误，或更新 `cspell.json` 添加自定义词汇

### 3. 最终验证

修复完成后，重新运行完整检查确认全部通过：

```bash
deno fmt --check && deno lint && deno check src/ && deno test --allow-env && npx cspell '**/*.ts' '**/*.md'
```

## 配置参考

| 工具       | 配置方式      | 用途                |
| ---------- | ------------- | ------------------- |
| Deno fmt   | `deno.json`   | 代码格式化          |
| Deno lint  | `deno.json`   | 代码检查            |
| Deno check | `deno.json`   | TypeScript 类型检查 |
| Deno test  | `deno.json`   | 测试运行            |
| cspell     | `cspell.json` | 拼写检查            |

## 代码风格

- 缩进: 2 空格
- 引号: 单引号
- 分号: 必须有
- 行宽: 100 字符

## 测试规范

- 测试文件: `src/*_test.ts`（与源码同目录）
- 框架: Deno 原生测试 API + `@std/assert`
- 覆盖率: `deno test --allow-env --coverage && deno coverage`
