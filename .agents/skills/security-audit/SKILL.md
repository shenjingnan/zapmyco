---
name: security-audit
description: 安全审计技能，用于检查和修复依赖安全问题
---

# 安全审计

## 上下文获取

以下命令将在技能加载时自动执行，结果将注入到上下文中供分析：

- 安全审计结果: !`bash .agents/skills/security-audit/scripts/run-security-audit.sh`

## 你的任务

根据上方注入的审计结果，按以下步骤处理：

### 1. 分析结果

逐项检查每个检查项的输出，判断是否存在安全问题：

1. **漏洞扫描** (`deno audit`) — 检查是否有已知漏洞，确认零漏洞则通过
2. **high/critical 级别漏洞** (`deno audit --level=high`) — 重点排查高危漏洞
3. **socket.dev 数据库** (`deno audit --socket`) — 更全面的漏洞检查
4. **过时依赖** (`deno outdated`) — 检查是否有可更新的依赖
5. **兼容更新** (`deno outdated --compatible`) — 确认可兼容升级的依赖

### 2. 修复漏洞

如果发现漏洞或过时依赖，对每个问题包依次处理：

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

### 3. 最终验证

修复完成后，确认所有检查通过：

```bash
deno fmt --check && deno lint && deno check src/ && deno test --allow-env
```

## 原则

- 优先通过 `deno audit --fix` 自动修复，无法修复时手动升级
- 升级后必须通过类型检查和测试验证
- 如果某个漏洞无法通过升级修复，考虑使用 `--ignore <CVE>` 绕过（需确认风险可接受）
