/**
 * 沙箱策略验证器
 *
 * 验证 SandboxConfig 是否符合安全基线。
 * 不涉及实际的 Docker/bubblewrap 执行（延后到 Phase 3）。
 *
 * @module security/sandbox
 */

import type { SandboxConfig, SandboxPolicyViolation } from '../types';

/** 危险的主机路径（绝不允许作为项目目录） */
const DANGEROUS_HOST_PATHS = ['/', '/etc', '/proc', '/sys', '/dev', '/boot', '/root'];

/**
 * 验证沙箱策略是否安全
 *
 * 返回违规列表。空列表表示配置安全。
 * Docker backend 延后到 Phase 3，Phase 2 仅做策略验证。
 */
export function validateSandboxPolicy(config: SandboxConfig): SandboxPolicyViolation[] {
  const violations: SandboxPolicyViolation[] = [];

  // --- Error 级别检查 ---

  // 检查 blockedHostPaths 是否遗漏关键系统路径
  if (config.filesystem.projectMount !== 'none') {
    const missingPaths = DANGEROUS_HOST_PATHS.filter(
      (p) => !config.filesystem.blockedHostPaths.includes(p)
    );
    if (missingPaths.length > 0) {
      violations.push({
        field: 'filesystem.blockedHostPaths',
        reason: `缺少关键系统路径: ${missingPaths.join(', ')}`,
        severity: 'error',
      });
    }
  }

  // projectMount 为 readwrite 时风险极高
  if (config.filesystem.projectMount === 'readwrite') {
    violations.push({
      field: 'filesystem.projectMount',
      reason: 'readwrite 模式风险极高，建议使用 readonly',
      severity: 'warning',
    });
  }

  // --- Warning 级别检查 ---

  // 生命周期不能过长
  if (config.maxLifetimeSec > 3600) {
    violations.push({
      field: 'maxLifetimeSec',
      reason: `生命周期过长 (${config.maxLifetimeSec}s > 3600s)，建议限制在 1 小时内`,
      severity: 'warning',
    });
  }

  // restricted 网络模式但允许全部域名
  if (config.network.mode === 'restricted' && !config.network.allowedDomains?.length) {
    violations.push({
      field: 'network.allowedDomains',
      reason: 'restricted 网络模式下未指定 allowedDomains，等同于完全开放',
      severity: 'warning',
    });
  }

  // 最大生命周期不能超过 24 小时
  if (config.maxLifetimeSec > 86400) {
    violations.push({
      field: 'maxLifetimeSec',
      reason: `生命周期超过 24 小时 (${config.maxLifetimeSec}s > 86400s)`,
      severity: 'error',
    });
  }

  // backend 为 docker 但无实际执行层（Phase 3 实现）
  if (config.backend === 'docker') {
    violations.push({
      field: 'backend',
      reason: 'Docker 沙箱后端将在 Phase 3 实现，当前仅做策略验证',
      severity: 'warning',
    });
  }

  return violations;
}
