---
name: lint
description: 运行代码检查、格式化和拼写检查
---

# Lint

运行完整的代码质量检查流程：类型检查、Biome 检查、格式化和拼写检查。

## 执行步骤

1. 运行类型检查: `pnpm run typecheck`
2. 运行 Biome 检查: `pnpm run lint`
3. 自动修复: `pnpm run lint:fix`
4. 格式化代码: `pnpm run format`
5. 拼写检查: `pnpm run spellcheck`

## 工具链

| 功能 | 工具 |
|------|------|
| Linter | Biome |
| 格式化 | Biome |
| 拼写检查 | cspell |
| 类型检查 | TypeScript (tsc) |

## 代码风格

- 缩进: 2 空格
- 引号: 单引号
- 分号: **必须有**
- 行宽: 100 字符

## 快捷命令

```bash
# 完整检查
pnpm run check

# 检查并修复
pnpm run check:fix
```
