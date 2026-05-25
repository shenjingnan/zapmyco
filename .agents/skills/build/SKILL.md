---
name: build
description: 构建 npm 包或编译二进制文件。当用户输入 /build 或要求构建项目时使用
---

# Build Command

构建项目。

## 执行步骤

1. 确保类型检查通过: `deno check src/`
2. 构建 npm 包: `deno run -A tools/build-npm.ts`
3. 验证构建产物存在于 `dist/` 目录

## 构建配置

- 构建工具: dnt (Deno to npm)
- 输出格式: CommonJS + ESM
- 类型声明: 自动生成 .d.ts
- Source Map: 启用

## 预期输出

```
dist/
├── npm/
│   ├── package.json
│   ├── index.js
│   ├── index.d.ts
│   └── ...
```

## 编译二进制

如需编译独立可执行文件:

```bash
deno compile --allow-env --allow-net -o dist/zapmyco src/index.ts
```
