---
name: typecheck
description: 运行 TypeScript 类型检查
---

# Typecheck

使用 TypeScript 编译器进行类型检查，不输出编译产物。

## 执行步骤

1. 运行类型检查: `pnpm run typecheck`

## 配置

| 配置项 | 值 |
|--------|-----|
| 工具 | TypeScript 编译器 (tsc) |
| 模式 | `--noEmit`（仅检查） |
| 配置文件 | `tsconfig.json` |

## 快捷命令

```bash
# 类型检查
pnpm run typecheck

# 完整检查（类型 + lint + 拼写）
pnpm run check

# 完整检查并自动修复
pnpm run check:fix
```
