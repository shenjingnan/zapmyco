/**
 * Sandbox 子模块类型定义
 *
 * 重导出 security/types.ts 中定义的沙箱相关类型。
 * Docker backend 延后到 Phase 3。
 *
 * @module security/sandbox
 */

export type {
  SandboxBackend,
  SandboxConfig,
  SandboxMountConfig,
  SandboxNetworkConfig,
  SandboxPolicyViolation,
} from '../types';
