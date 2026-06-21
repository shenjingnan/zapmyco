# CLAUDE.md - AI 原生 Rust CLI 工具

本文档为 Claude Code 提供项目上下文和开发规范。

## 项目概述

**zapmyco** 是一个 AI 驱动的命令行工具，基于 Anthropic 兼容 API 提供交互式 LLM 聊天会话。\
基于 **Rust** 运行时，发布到 **crates.io** 和 **GitHub Releases**。

## 技术栈

| 技术           | 版本   | 用途                         |
| -------------- | ------ | ---------------------------- |
| Rust           | 1.95+  | 编程语言 / 编译 / 测试 / Lint / Format |
| clap           | 4.x    | CLI 参数解析                 |
| anthropic-ai-sdk | 0.2 | Anthropic Messages API 客户端 |
| inquire        | 0.7    | 交互式终端提示               |
| tokio          | 1.x    | 异步运行时                   |
| serde          | 1.x    | JSON 配置序列化/反序列化     |
| cargo-audit    | —      | 依赖安全审计（可选安装）     |

## 快速命令参考

```bash
# 开发
cargo run                           # 直接运行（无参进入交互模式）
cargo run -- config                 # 显示配置
cargo run -- init                   # 交互式初始化向导
cargo run -- settings               # 显示 LLM 配置
cargo run -- settings path          # 显示配置路径
cargo run -- run "prompt"           # 一次性 AI 任务
cargo watch -x run                  # 开发模式 (需 cargo-watch)

# 测试
cargo test                          # 运行测试
cargo test -- --test-threads=1      # 单线程测试（避免 env 竞争）

# 代码质量
cargo fmt                           # 格式化代码
cargo fmt --check                   # 格式检查
cargo clippy                        # Lint 检查
cargo clippy -- -D warnings         # 严格 Lint 检查
cargo test                          # 测试
cargo fmt --check && cargo clippy -- -D warnings && cargo test -- --test-threads=1  # 完整检查

# Git 钩子 (Lefthook)
lefthook run pre-commit --all-files  # 运行所有 pre-commit 检查
lefthook run pre-push               # 运行 pre-push 检查
lefthook run commit-msg <file>      # 校验 commit 信息格式
lefthook validate                   # 验证 lefthook.yml 配置
lefthook install                    # 重新安装 Git 钩子

# 构建
cargo build                         # 调试构建
cargo build --release               # 发布构建

# 文档
cargo doc --open                    # 生成并打开 API 文档

# 发布
cargo publish --dry-run             # 发布预检
cargo publish                       # 发布到 crates.io
```

## 代码风格规范

由 `cargo fmt` 和 `cargo clippy` 强制执行（Rust Edition 2024）：

- **缩进**: 2 空格
- **引号**: 单引号（除字符串外）
- **分号**: 必须有
- **行宽**: 最大 100 字符
- **尾随逗号**: 默认

### 命名约定

| 类型      | 约定                 | 示例           |
| --------- | -------------------- | -------------- |
| 文件      | snake_case           | `my_module.rs` |
| 类/结构体 | PascalCase           | `MyStruct`     |
| 函数/变量 | snake_case           | `my_function`  |
| 常量      | SCREAMING_SNAKE_CASE | `MAX_COUNT`    |
| 类型/trait| PascalCase           | `UserConfig`   |
| 枚举      | PascalCase           | `ModelRole`    |

## Git 工作流

### 分支命名

- `feature/xxx` - 新功能
- `fix/xxx` - Bug 修复
- `docs/xxx` - 文档更新
- `refactor/xxx` - 重构

### Commit 规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]
```

**类型**:

- `feat` - 新功能
- `fix` - Bug 修复
- `docs` - 文档
- `style` - 代码格式
- `refactor` - 重构
- `perf` - 性能优化
- `test` - 测试
- `chore` - 构建/工具

## 测试规范

### 测试文件位置

- 单元测试: `src/*.rs` 中的 `#[cfg(test)] mod tests`
- 集成测试: `tests/*.rs`

### 测试格式

```rust
use crate::my_function;

#[test]
fn test_my_function() {
    assert_eq!(my_function("valid"), "expected");
}

#[test]
fn test_error_case() {
    assert!(my_function("").is_err());
}
```

### 测试覆盖率

```bash
cargo tarpaulin                     # 需要 cargo-tarpaulin
```

## 关键规则

1. **提交前检查**: 由 lefthook 自动执行 `cargo fmt --check && cargo clippy -- -D warnings && cargo test -- --test-threads=1 && typos .`，也可手动运行 `lefthook run pre-commit --all-files`
2. **类型安全**: 避免不必要的 `unwrap()`，优先使用 `?` 或模式匹配
3. **文档更新**: 新功能需更新相关文档
4. **测试覆盖**: 新代码需要有对应的测试
5. **中文优先**: 所有文档、commit 信息、PR 信息、注释等有必要的场景优先使用中文

## 可用 Slash Commands

| 命令       | 说明                     |
| ---------- | ------------------------ |
| `/build`   | 构建项目（release）      |
| `/test`    | 运行测试                 |
| `/check`   | 完整代码质量检查（由 lefthook 执行） |
| `/lint`    | Lint 检查                |
| `/release` | 创建发布                 |
| `/spellcheck` | 拼写检查             |

## 常见问题

### 如何添加新功能？

1. 创建功能分支: `git checkout -b feature/my-feature`
2. 实现功能代码
3. 编写测试用例
4. 运行检查: `cargo fmt --check && cargo clippy -- -D warnings && cargo test -- --test-threads=1`
5. 提交代码: `git commit -m "feat: add my feature"`
6. 创建 PR

### 如何修复 Bug？

1. 创建修复分支: `git checkout -b fix/my-bug`
2. 编写失败的测试用例 (复现 Bug)
3. 修复代码
4. 验证测试通过
5. 提交代码: `git commit -m "fix: resolve my bug"`
6. 创建 PR

### 如何发布新版本？

1. 在 `Cargo.toml` 中更新 `version` 字段
2. 提交版本更新
3. 运行 `cargo publish --dry-run` 预检
4. 创建 GitHub Release（触发自动发布到 crates.io 和多平台二进制构建）
