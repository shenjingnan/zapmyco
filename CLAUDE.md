# CLAUDE.md - AI 原生 TypeScript 启动模板 (Deno)

本文档为 Claude Code 提供项目上下文和开发规范。

## 项目概述

**ai-typescript-starter** 是一个 AI 原生的 TypeScript 启动模板，专为 AI 辅助开发时代打造。\
基于 **Deno 2.x** 运行时，发布到 **JSR** 和 **npm**。

## 技术栈

| 技术       | 版本     | 用途                                            |
| ---------- | -------- | ----------------------------------------------- |
| Deno       | 2.8+     | 运行时 / TypeScript 编译 / 测试 / Lint / Format |
| TypeScript | 原生支持 | 编程语言                                        |
| cspell     | 8.x      | 拼写检查 (npm)                                  |
| dnt        | 0.42.x   | Deno → npm 转换 (JSR)                           |
| JSR        | —        | 包发布 registry (zapmyco)                       |
| npm        | —        | 包发布 registry (zapmyco)                       |

## 快速命令参考

```bash
# 开发
deno run src/index.ts                # 直接运行
deno run --watch src/index.ts        # 开发模式 (watch)

# 测试
deno test                            # 运行测试
deno test --coverage                 # 覆盖率收集
deno coverage                        # 查看覆盖率报告

# 代码质量
deno lint                            # 代码检查
deno fmt                             # 格式化代码
deno fmt --check                     # 格式检查
deno check                           # 类型检查
deno fmt --check && deno lint && deno check && deno test  # 完整检查

# 发布（release-plz 自动化）
# 提交 conventional commits → push 到 main → release-plz 自动创建 release PR
# 合并 release PR → 自动发布到 crates.io + GitHub Release → 构建多平台二进制
# 版本号由 release-plz 根据 commits 自动推导，无需手动修改
cargo test                               # 发布前确保测试通过
# 更多细节请参考 .agents/skills/release/SKILL.md
```

## 代码风格规范

由 `deno fmt` 和 `deno lint` 强制执行，配置在 `deno.json` 中：

- **缩进**: 2 空格
- **引号**: 单引号
- **分号**: 必须有
- **行宽**: 最大 100 字符
- **尾随逗号**: 默认

### TypeScript 规范

- 严格模式开启
- 禁止 `any` 类型 (warn)
- 显式定义公共函数返回类型
- 使用 `const` 优先，`let` 仅在必要时使用
- 使用可选链 (`?.`) 和空值合并 (`??`)

### 命名约定

| 类型      | 约定                 | 示例           |
| --------- | -------------------- | -------------- |
| 文件      | kebab-case           | `my-module.ts` |
| 类        | PascalCase           | `MyClass`      |
| 函数/变量 | camelCase            | `myFunction`   |
| 常量      | SCREAMING_SNAKE_CASE | `MAX_COUNT`    |
| 类型/接口 | PascalCase           | `UserConfig`   |

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

**示例**:

```
feat: add new utility function
fix(utils): handle null case in formatDate
docs: update README with new examples
```

## 测试规范

### 测试文件位置

- 遵循 Deno 惯例: `src/*_test.ts`（与源码同目录）
- 使用 Deno 原生测试 API + `@std/assert`

### 测试格式

```typescript
import { assertEquals, assertThrows } from 'jsr:@std/assert';
import { myFunction } from './index.ts';

Deno.test('MyModule', async (t) => {
  await t.step('should return correct value when input is valid', () => {
    assertEquals(myFunction('valid'), 'expected');
  });

  await t.step('should throw error when input is invalid', () => {
    assertThrows(() => myFunction(''), TypeError);
  });
});
```

### 测试覆盖率

- 运行 `deno test --coverage && deno coverage`
- 生成 lcov 报告:
  `deno test --coverage=coverage && deno coverage --lcov coverage > coverage/lcov.info`

## 关键规则

1. **提交前检查**: 确保 `deno fmt --check && deno lint && deno check && deno test` 全部通过
2. **类型安全**: 避免使用 `any`，优先使用具体类型或泛型
3. **文档更新**: 新功能需更新相关文档
4. **测试覆盖**: 新代码需要有对应的测试
5. **中文优先**: 所有文档、commit 信息、PR 信息、注释等有必要的场景优先使用中文

## 可用 Slash Commands

| 命令                  | 触发方式      | 说明                   |
| --------------------- | ------------- | ---------------------- |
| `/build`              | `/build`      | 构建 npm 包/二进制文件 |
| `/test`               | `/test`       | 运行测试套件           |
| `/lint`               | `/lint`       | 代码检查和格式化       |
| `/release`            | `/release`    | 创建发布               |
| `/spellcheck`         | `/spellcheck` | 运行拼写检查           |
| `/typecheck`          | `/typecheck`  | 运行类型检查           |
| coverage              | 自然语言触发  | 分析测试覆盖率         |
| spellcheck            | 自然语言触发  | 拼写检查               |
| typecheck             | 自然语言触发  | 类型检查               |
| commit-push-pr        | 自然语言触发  | 提交、推送并创建 PR    |
| update-readme         | 自然语言触发  | 更新 README.md         |
| security-audit        | 自然语言触发  | 依赖安全审计           |
| project-context       | 自动加载      | 项目上下文理解         |
| resolve-git-conflicts | 自动检测      | 解决 Git 合并冲突      |

## 常见问题

### 如何添加新功能？

1. 创建功能分支: `git checkout -b feature/my-feature`
2. 实现功能代码
3. 编写测试用例
4. 运行检查: `deno fmt --check && deno lint && deno check src/ && deno test`
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

使用 release-plz 自动化发布（参考 `.agents/skills/release/SKILL.md` 获取完整流程）：

1. 确保 commits 遵循 conventional commits 规范（`feat:`、`fix:` 等）
2. 推送到 main 分支
3. release-plz 自动创建 release PR（含版本号 + CHANGELOG 更新）
4. 审查并合并 release PR
5. 自动发布到 crates.io 并创建 GitHub Release
6. CI 自动构建多平台二进制并上传到 Release

版本号由 release-plz 根据 conventional commits 自动推导：
- `BREAKING CHANGE` → major
- `feat` → minor
- `fix` / `refactor` / `docs` 等 → patch
