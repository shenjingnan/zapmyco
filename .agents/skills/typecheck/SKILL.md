---
name: typecheck
description: 运行 TypeScript 类型检查。当用户输入 /typecheck 或要求类型检查时使用
---

# Typecheck Command

运行类型检查。

## 执行步骤

1. 运行类型检查: `deno check src/`

## 配置

- **工具**: Deno 内置 TypeScript 检查器
- **模式**: `--noEmit`（仅检查，不输出文件）
- **编译器配置**: `deno.json` 中的 `compilerOptions`

## 快捷命令

```bash
# 类型检查
deno check src/

# 完整检查（包含类型检查）
deno fmt --check && deno lint && deno check src/ && deno test --allow-env
```
