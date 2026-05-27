---
name: release
description: 创建项目发布。当用户输入 /release 或要求发布新版本时使用
---

# Release Command

使用 release-plz 自动化发布到 crates.io 和 GitHub Releases。

## release-plz 工作流程

release-plz 会根据 conventional commits 自动计算下一个版本号，整个过程无需手动干预：

```
开发者提交 conventional commits → push 到 main → release-plz 创建 release PR
→ 合并 release PR → 自动发布到 crates.io → 创建 GitHub Release → 构建多平台二进制
```

### 详细步骤

1. **提交 conventional commits**
   - `feat:` → minor 版本更新
   - `fix:` → patch 版本更新
   - `BREAKING CHANGE` → major 版本更新

2. **推送到 main 分支**
   - GitHub Actions 自动触发 `release-plz` workflow
   - `release-plz-pr` job 扫描 commits，计算新版本号
   - 自动创建 release PR（包含 `Cargo.toml` 版本更新 + `CHANGELOG.md` 更新）

3. **审查并合并 release PR**
   - 检查 release PR 中的版本号和 CHANGELOG
   - 合并到 main

4. **自动发布**
   - `release-plz-release` job 自动执行：
     - 运行测试（质量门禁）
     - `cargo publish` → crates.io
     - 创建 Git tag + GitHub Release

5. **二进制构建（自动触发）**
   - GitHub Release 触发 `Build Binaries` workflow
   - 构建多平台二进制并上传到 Release

## 版本规范

遵循语义化版本规范，由 release-plz 根据 conventional commits 自动推导：

- **major**: 包含 `BREAKING CHANGE` 的 commit（1.0.0 → 2.0.0）
- **minor**: `feat` 类型的 commit（1.0.0 → 1.1.0）
- **patch**: `fix` 或其他类型的 commit（1.0.0 → 0.1.1）

## 紧急手动发布

如果 release-plz 自动流程不可用，可以手动发布：

```bash
# 1. 更新 Cargo.toml 版本号
# 2. 提交并推送
# 3. 手动发布
cargo publish
# 4. 创建 GitHub Release
gh release create v<version> --title "v<version>" --generate-notes
```
