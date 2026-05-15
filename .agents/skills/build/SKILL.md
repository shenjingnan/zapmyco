---
name: build
description: 构建项目，运行类型检查和打包
---

# Build

构建项目，生成 ESM 格式的产物和类型声明文件。

## 执行步骤

1. 运行类型检查: `pnpm run typecheck`
2. 运行构建: `pnpm run build`
3. 验证构建产物存在于 `dist/` 目录

## 构建配置

| 配置项 | 值 |
|--------|-----|
| 构建工具 | tsdown |
| 输出格式 | ESM |
| 类型声明 | 自动生成 `.d.ts` |
| Source Map | 启用 |

## 预期产物

```
dist/
├── index.mjs
├── index.mjs.map
├── index.d.mts
└── index.d.mts.map
```

## 快捷命令

```bash
pnpm run build
```
