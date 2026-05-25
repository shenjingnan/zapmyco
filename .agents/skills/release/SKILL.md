---
name: release
description: 创建项目发布。当用户输入 /release 或要求发布新版本时使用
---

# Release Command

创建项目发布。

## 执行步骤

1. 确保所有测试通过: `deno test --allow-env`
2. 确保代码检查通过: `deno fmt --check && deno lint && deno check src/`
3. 构建 npm 包: `deno run -A tools/build-npm.ts`
4. 发布预检: `deno publish --dry-run`
5. 运行发布: `deno run -A tools/release.ts`

## 发布流程

`tools/release.ts` 会自动执行以下操作：

1. 解析 conventional commits，推导版本号
2. 更新 `deno.json` 版本号
3. 更新 `CHANGELOG.md`
4. 创建 Git commit + tag
5. 推送到远程仓库
6. 创建 GitHub Release

## 版本规范

遵循语义化版本规范：

- **major**: 不兼容的 API 变更
- **minor**: 向后兼容的新功能
- **patch**: 向后兼容的 Bug 修复

## 预检

```bash
# 发布预检（不实际发布）
deno run -A tools/release.ts --dry-run
```

## GitHub Actions 自动发布

发布新 Release 后，CI 会自动执行：

- `deno publish` → JSR
- dnt 构建 + `npm publish --provenance` → npm
