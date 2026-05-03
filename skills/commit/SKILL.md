---
name: commit
description: 创建规范的 git commit，自动分析变更并生成符合 Conventional Commits 规范的提交信息
version: "1.0"
user-invocable: true
argument-hint: "[--no-verify]"
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
compatibility:
  commands: [git]
  os: [darwin, linux, win32]
---

# Git Commit 技能

创建符合 [Conventional Commits](https://www.conventionalcommits.org/) 规范的 git commit。

## 执行步骤

1. 运行 `git status` 查看当前工作区状态
2. 运行 `git diff` 查看未暂存的变更
3. 运行 `git log --oneline -5` 查看最近的 commit 风格
4. 分析变更内容，确定 commit 类型：
   - `feat`: 新功能
   - `fix`: Bug 修复
   - `docs`: 文档更新
   - `style`: 代码格式
   - `refactor`: 重构
   - `perf`: 性能优化
   - `test`: 测试
   - `chore`: 构建/工具
5. 确定 scope（可选，根据变更文件路径推断）
6. 生成 commit 信息（中文正文）

## Commit 信息格式

```
<type>(<scope>): <简短描述>

<详细正文（可选）>
```

## 安全检查

- 不要提交包含密钥的文件（.env, credentials.json 等）
- 不要使用 `--no-verify` 跳过 hooks（除非用户明确要求）
- 不要提交大二进制文件

## 完成后

向用户展示创建的 commit 信息。
