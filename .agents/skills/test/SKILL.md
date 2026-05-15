---
name: test
description: 运行测试套件，支持覆盖率报告和监听模式
---

# Test

运行项目测试套件，使用 Vitest 框架。

## 执行步骤

1. 运行测试: `pnpm run test`
2. 如需覆盖率报告: `pnpm run test:coverage`

## 测试配置

| 配置项 | 值 |
|--------|-----|
| 测试框架 | Vitest |
| 环境 | Node.js |
| 全局 API | 启用 |
| 覆盖率阈值 | 80% |

## 测试文件位置

- 单元测试: `src/**/*.test.ts`
- 集成测试: `tests/**/*.test.ts`

## 常用命令

```bash
# 运行所有测试
pnpm run test

# 监听模式
pnpm run test:watch

# 生成覆盖率报告
pnpm run test:coverage
```
