---
name: release
description: 创建项目发布。当用户输入 /release 或要求发布新版本时使用
---

# Release 命令

在 main 分支上触发 release-plz 自动发布流程。

## 上下文获取

以下脚本将在技能加载时自动执行，结果将注入到上下文中供分析：

- 上下文信息: !`bash .agents/skills/release/scripts/gather-context.sh`

## 你的任务

### 1. 检查分支

检查当前是否在 main 分支：
- 如果在 main，继续下一步
- 如果不在 main，提示用户先切换到 main 分支（`git checkout main`）后再执行 `/release`

### 2. 检查未发布的 commits

确认自上次 tag 以来有新的 conventional commits：
- `feat:` → minor 版本更新
- `fix:` → patch 版本更新
- `BREAKING CHANGE` → major 版本更新
- 其他类型（`refactor:`、`docs:`、`chore:` 等）→ patch 版本更新

如果自上次 tag 以来没有新的 commits，提示用户当前没有需要发布的内容。

### 3. 同步远端

确保本地与远端同步：

```bash
git pull --ff-only origin main
```

### 4. 运行测试

```bash
cargo test
```

确保测试全部通过，避免 Release 合并后 CI 失败。

### 5. 推送触发 CI

将 main 分支推送到远端，触发 GitHub Actions 中的 release-plz-pr Job：

```bash
git push origin main
```

### 6. 说明后续流程

推送完成后，告知用户后续将进入 **Phase 2（CI 自动化）**，流程如下：

1. **GitHub Actions 自动创建 Release PR**
   - `release-plz-pr` Job 扫描 main 上的 conventional commits
   - 自动计算版本号（major/minor/patch）
   - 更新 `Cargo.toml` 版本号
   - 更新 `CHANGELOG.md`
   - 创建 Release PR
   - ※ 不再重复运行测试（Phase 1 已完成）

2. **用户审核并合并 Release PR**
   - 前往 GitHub 仓库查看自动创建的 Release PR
   - 审核版本号和 CHANGELOG 是否正确
   - 合并 Release PR 到 main

3. **自动发布**
   - 发布到 **crates.io**（Trusted Publishing / OIDC）
   - 创建 **GitHub tag + Release**
   - 构建 **5 平台二进制**并上传到 Release
   - 生成 **SHA256SUMS** 校验和

## 发布流程参考

```
多次 feat/fix PR 合并到 main     ← 日常开发
         ↓                                    ┐
决定发布 → 执行 /release skill                 │ Phase 1
  ├─ 检查分支 & commits                        │ 本地 Skill
  ├─ git pull --ff-only                       │
  ├─ cargo test                               │
  └─ git push origin main                     ┘
         ↓
GitHub Actions                                ┐
         │                                    │ Phase 2
         ↓                                    │ CI 自动化
Job 1: release-plz release-pr
  ├─ 创建 Release PR（自动计算版本号 + 更新 CHANGELOG）
         ↓
用户审核并合并 Release PR
         ↓
Job 2: release-plz release                    ┘
  ├─ 发布到 crates.io
  ├─ 创建 GitHub tag + Release
  ↓
Job 3: 构建 5 平台二进制 → 上传到 Release
  ↓
Job 4: 生成 SHA256SUMS → 上传到 Release
  ↓
✅ 发布完成
```

## 版本规范

遵循语义化版本规范，由 release-plz 根据 conventional commits 自动推导：

- **major**: 包含 `BREAKING CHANGE` 的 commit（0.23.0 → 1.0.0）
- **minor**: `feat` 类型的 commit（0.22.2 → 0.23.0）
- **patch**: `fix` 或其他类型的 commit（0.22.2 → 0.22.3）
