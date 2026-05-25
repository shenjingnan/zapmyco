---
name: lint
description: 运行代码检查和格式化。当用户输入 /lint 或要求代码检查时使用
---

# Lint Command

运行代码检查和格式化。

## 执行步骤

1. 运行类型检查: `deno check src/`
2. 运行 Deno Lint: `deno lint`
3. 格式化代码: `deno fmt`
4. 拼写检查: `deno run -A tools/spellcheck.ts` 或 `cspell`

## Lint 配置

- **Linter**: Deno Lint（配置在 `deno.json`）
- **格式化**: Deno fmt（配置在 `deno.json`）
- **拼写检查**: cspell（配置在 `cspell.json`）

## 代码风格

- 缩进: 2 空格
- 引号: 单引号
- 分号: 必须有
- 行宽: 100 字符

## 快捷命令

```bash
# 完整检查
deno fmt --check && deno lint && deno check src/ && deno test --allow-env

# 格式化所有代码
deno fmt

# 只检查格式（不修改）
deno fmt --check
```
