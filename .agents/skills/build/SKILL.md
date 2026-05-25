---
name: build
description: 构建 npm 包或编译二进制文件。当用户输入 /build 或要求构建项目时使用
---

# Build Command

构建项目。

## 上下文获取

以下命令将在技能加载时自动执行，结果将注入到上下文中供分析：

- 全部构建结果: !`bash .agents/skills/build/scripts/build.sh`

## 你的任务

根据上方注入的构建结果，按以下步骤处理：

### 1. 分析结果

逐项检查每个步骤的输出，判断是否有错误：

1. **类型检查** — 检查 `deno check` 输出，修复类型错误
2. **构建输出** — 检查 dnt 构建日志，修复构建错误
3. **产物验证** — 确认 `dist/npm/` 目录包含 `package.json`、`esm/src/index.js`、`types/`

### 2. 修复问题

如果构建失败，根据错误类型修复：

1. **类型错误** — 分析 `deno check` 输出并修复类型错误，然后重新运行 `/build`
2. **构建错误** — 分析 dnt 输出并修复问题，然后重新运行 `/build`

### 3. 构建成功

如果所有步骤通过，告知用户构建成功及产物位置。

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
│   ├── esm/src/index.js      # ESM 入口
│   ├── types/src/index.d.ts  # 类型声明
│   └── ...
```

## 编译二进制

如果用户要求编译独立可执行文件，直接在 shell 中执行：

```bash
deno compile --allow-env --allow-net -o dist/zapmyco src/index.ts
```
