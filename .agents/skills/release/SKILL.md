---
name: release
description: 创建项目发布。当用户输入 /release 或要求发布新版本时使用
argument-hint: '[tag]'
arguments: [tag]
---

# Release Command

创建项目发布。

## 上下文获取

以下命令将在技能加载时自动执行，结果将注入到上下文中供分析：

- 全部发布结果: !`bash .agents/skills/release/scripts/run-preflight.sh`

## 你的任务

根据上方注入的干跑结果和用户的要求，按以下步骤处理：

### 1. 分析干跑结果

查看 `---[release dry-run]---` 中的输出：

- 确认当前版本、推导的版本号和 bump 类型
- 如果干跑失败，分析原因并告知用户

### 2. 确定发布参数

根据用户输入的参数确定最终发布命令（`$tag` 会自动替换为用户输入的参数）：

| 用户意图               | 执行命令                                  |
| ---------------------- | ----------------------------------------- |
| `/release`（标准发布） | `deno run -A tools/release.ts`            |
| `/release beta`        | `deno run -A tools/release.ts --tag $tag` |
| `/release alpha`       | `deno run -A tools/release.ts --tag $tag` |
| 仅预检，不发布         | 告知用户干跑结果即可                      |

如果用户没有指定 tag，直接进行标准发布；如果指定了 tag（如 beta、alpha、rc），使用 `--tag $tag`
参数执行发布。

### 3. 执行发布

```bash
# 示例：标准发布
deno run -A tools/release.ts

# 示例：beta 发布
deno run -A tools/release.ts --tag beta
# 用户输入 /release beta，$tag 自动替换为 beta
```

发布成功后告知用户版本号和 GitHub Release 链接。

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
