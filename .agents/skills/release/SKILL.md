---
name: release
description: 创建项目发布。当用户输入 /release 或要求发布新版本时使用
---

# Release Command

创建项目发布到 crates.io 和 GitHub Releases。

## 上下文获取

以下命令将在技能加载时自动执行，结果将注入到上下文中供分析：

- 全部发布结果: !`bash .agents/skills/release/scripts/run-preflight.sh`

## 你的任务

根据上方注入的干跑结果和用户的要求，按以下步骤处理：

### 1. 分析干跑结果

查看 `---[cargo publish --dry-run]---` 中的输出：

- 确认版本号、依赖检查、构建是否通过
- 如果干跑失败，分析原因并告知用户

### 2. 执行发布

```bash
# 更新 Cargo.toml 版本号（手动更新 version 字段）
# 然后运行：
cargo publish
```

发布成功后告知用户版本号。

### 3. GitHub Release

crates.io 发布完成后，创建 GitHub Release 触发 CI 自动构建多平台二进制：

```bash
git tag -a v<version> -m "v<version>"
git push origin --tags
gh release create v<version> --title "v<version>" --generate-notes
```

## 发布流程

1. 更新 `Cargo.toml` 中的 `version` 字段
2. 提交版本更新: `git commit -m "chore(release): v<version>"`
3. 运行 `cargo publish --dry-run` 预检
4. 发布到 crates.io: `cargo publish`
5. 创建 GitHub Release: `gh release create`

## GitHub Actions 自动发布

创建 GitHub Release 后，CI 会自动执行：

- 多平台交叉编译（linux-x64/arm64, macos-arm64/x64, windows-x64）
- 上传二进制文件和 SHA256SUMS 到 Release

## 版本规范

遵循语义化版本规范：

- **major**: 不兼容的 API 变更（1.0.0 → 2.0.0）
- **minor**: 向后兼容的新功能（1.0.0 → 1.1.0）
- **patch**: 向后兼容的 Bug 修复（1.0.0 → 1.0.1）
