---
name: security-audit
description: 安全审计技能，用于检查和修复依赖安全问题
---

# 安全审计

## 执行步骤

### 1. 执行安全审计

检查依赖中的已知漏洞：

```bash
deno audit
```

仅查看 high 和 critical 级别漏洞：

```bash
deno audit --level=high
```

使用 socket.dev 漏洞数据库（更全面的检查）：

```bash
deno audit --socket
```

零漏洞则结束。

### 2. 检查过时依赖

```bash
deno outdated
```

查看可兼容更新的依赖：

```bash
deno outdated --compatible
```

### 3. 修复漏洞

对每个漏洞包：

1. **尝试自动修复**：
   ```bash
   deno audit --fix
   ```
   或手动更新到最新兼容版本：
   ```bash
   deno outdated --update --latest <包名>
   ```

2. **验证**：运行 `deno check src/ && deno test --allow-env && deno lint`

3. **验证失败则回滚**：
   ```bash
   git checkout -- deno.json deno.lock
   ```

### 4. 收尾

- 确认 `deno audit` 通过
- 重新运行完整检查：`deno fmt --check && deno lint && deno check src/ && deno test --allow-env`

## 原则

- 优先通过 `deno audit --fix` 自动修复，无法修复时手动升级
- 升级后必须通过类型检查和测试验证
- 如果某个漏洞无法通过升级修复，考虑使用 `--ignore <CVE>` 绕过（需确认风险可接受）
