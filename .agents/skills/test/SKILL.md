---
name: test
description: 运行测试套件。当用户输入 /test 或要求运行测试时使用
---

# Test Command

运行测试套件。

## 执行步骤

1. 运行测试: `deno test --allow-env`
2. 如需覆盖率报告: `deno test --allow-env --coverage && deno coverage`

## 测试配置

- **测试框架**: Deno 原生测试
- **断言库**: `@std/assert`
- **覆盖率阈值**: 无（按需检查）

## 测试文件位置

- 单元测试: `src/*_test.ts`（与源码同目录）

## 常用命令

```bash
# 运行所有测试
deno test --allow-env

# 运行指定测试文件
deno test --allow-env src/xxx_test.ts

# 生成覆盖率报告
deno test --allow-env --coverage && deno coverage

# 输出 LCOV 格式覆盖率
deno test --allow-env --coverage=coverage && deno coverage --lcov coverage > coverage/lcov.info
```
