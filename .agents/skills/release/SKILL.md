---
name: release
description: 创建项目发布。当用户输入 /release 或要求发布新版本时使用
---

# Release Command

创建项目发布。

## 上下文获取

以下命令将在技能加载时自动执行，结果将注入到上下文中供分析：

- 全部发布结果: !`bash .agents/skills/release/scripts/run-preflight.sh`

## 你的任务

根据上方注入的发布输出，判断发布是否成功：

- **发布成功** — `---[release output]---` 末尾显示 `🎉 发布完成`，告知用户版本号和 GitHub Release
  链接
- **发布失败** — 分析失败原因（前置检查不通过、版本推导失败、GitHub Release
  创建失败等），告知用户具体错误

## 发布流程

`tools/release.ts` 会自动执行以下操作：

1. 前置检查：分支为 main、工作区干净、gh 已认证
2. 解析 conventional commits，推导版本号
3. 更新 `deno.json` 版本号
4. 更新 `CHANGELOG.md`
5. 创建 Git commit + tag
6. 推送到远程仓库
7. 创建 GitHub Release

## 版本规范

遵循语义化版本规范：

- **major**: 不兼容的 API 变更
- **minor**: 向后兼容的新功能
- **patch**: 向后兼容的 Bug 修复

## GitHub Actions 自动发布

发布新 Release 后，CI 会自动执行：

- `deno publish` → JSR
- dnt 构建 + `npm publish --provenance` → npm
