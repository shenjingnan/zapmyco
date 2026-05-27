---
name: release
description: 创建项目发布。当用户输入 /release 或要求发布新版本时使用
---

# Release Command

使用 release-plz 自动化发布到 crates.io 和 GitHub Releases。

## 发布架构

```
你提交 commits → 创建 PR → 合并到 main
    ↓
GitHub Actions: release.yml 自动触发
    ├─ Job 1: release-plz-pr ─── 创建 Release PR
    ├─ Job 2: publish ─── cargo test → cargo publish → 创建 GitHub Release
    │       └─ 检测到新 tag →
    ├─ Job 3: build-binaries ─── 构建 5 平台二进制 → 上传到 Release
    └─ Job 4: generate-checksums ─── 合并 SHA256 → 上传到 Release
```

### 正常发布流程

1. **提交 conventional commits**
   - `feat:` → minor 版本更新
   - `fix:` → patch 版本更新
   - `BREAKING CHANGE` → major 版本更新

2. **通过 PR 合并到 main**
   → release.yml 自动触发

3. **release-plz-pr 创建 Release PR**
   - release-plz 扫描 commits 计算新版本号
   - 自动创建 Release PR（含 Cargo.toml 版本更新 + CHANGELOG.md 更新）

4. **审查并合并 Release PR**
   - 检查版本号和 CHANGELOG 内容
   - 合并到 main

5. **自动发布**
   - cargo test（质量门禁）
   - cargo publish → crates.io（使用 Trusted Publishing / OIDC）
   - 创建 Git tag + GitHub Release

6. **二进制构建（自动）**
   - 构建 5 平台二进制（linux x64/arm64, macos arm64/x64, windows x64）
   - 上传到 GitHub Release
   - 生成 SHA256SUMS

## 版本规范

遵循语义化版本规范，由 release-plz 根据 conventional commits 自动推导：

- **major**: 包含 `BREAKING CHANGE` 的 commit（0.23.0 → 1.0.0）
- **minor**: `feat` 类型的 commit（0.22.2 → 0.23.0）
- **patch**: `fix` 或其他类型的 commit（0.22.2 → 0.22.3）

## 注意事项

### Trusted Publishing

项目已启用 crates.io Trusted Publishing（OIDC），无需 `CARGO_REGISTRY_TOKEN`。
GitHub Actions 自动通过 OIDC 认证发布。

相关文档: https://doc.rust-lang.org/cargo/reference/trusted-publishing.html

### 首次发布特殊情况

如果 crates.io 上的版本低于 Cargo.toml 中的版本（如 registry 只有 0.1.0 而本地是 0.22.2），
release-plz 不会创建 Release PR。此时合并 workflow 变更后，publish job 会直接发布当前版本。
后续再次提交 conventional commits 后，release-plz 即可正常创建 Release PR。

## 紧急手动发布

如果 release-plz 自动流程不可用，可以手动发布：

```bash
# 1. 确保已启用 Trusted Publishing（crates.io 配置）
#    或使用 cargo login 配置 token
# 2. 发布到 crates.io
cargo publish
# 3. 创建 GitHub Release
gh release create v<version> --title "v<version>" --generate-notes
# 4. 二进制构建会在 GitHub Release 创建后自动触发
#    也可手动触发: gh workflow run release.yml
```
