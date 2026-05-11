/**
 * permission-engine 单元测试
 */
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '@/security/permission-config';
import type { ToolInfoResolver } from '@/security/permission-engine';
import { PermissionEngine } from '@/security/permission-engine';
import { PermissionStore } from '@/security/permission-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createResolver(overrides: Record<string, any> = {}): ToolInfoResolver {
  return (toolId: string) => {
    const override = overrides[toolId];
    if (override) {
      return {
        checkPermission: override.checkPermission,
        defaultRisk: override.defaultRisk,
      };
    }
    return { checkPermission: undefined, defaultRisk: undefined };
  };
}

describe('PermissionEngine', () => {
  // ============ 正常模式 ============

  describe('normal mode', () => {
    it('should allow low risk tools directly', () => {
      const config = resolveConfig({ mode: 'normal' });
      const store = new PermissionStore();
      const resolver = createResolver({ ReadFile: { defaultRisk: 'low' } });
      const engine = new PermissionEngine(config, store, resolver);

      const decision = engine.evaluate('ReadFile', {});
      expect(decision.action).toBe('allow');
      expect(decision.requiresApproval).toBe(false);
    });

    it('should ask for medium risk tools', () => {
      const config = resolveConfig({ mode: 'normal' });
      const store = new PermissionStore();
      const resolver = createResolver({ Exec: { defaultRisk: 'medium' } });
      const engine = new PermissionEngine(config, store, resolver);

      const decision = engine.evaluate('Exec', { command: 'ls' });
      expect(decision.action).toBe('ask');
      expect(decision.requiresApproval).toBe(true);
    });

    it('should ask for high risk tools', () => {
      const config = resolveConfig({ mode: 'normal' });
      const store = new PermissionStore();
      const resolver = createResolver({ SpawnSubAgents: { defaultRisk: 'high' } });
      const engine = new PermissionEngine(config, store, resolver);

      const decision = engine.evaluate('SpawnSubAgents', {});
      expect(decision.action).toBe('ask');
      expect(decision.requiresApproval).toBe(true);
    });

    it('should deny critical risk tools', () => {
      const config = resolveConfig({ mode: 'normal' });
      const store = new PermissionStore();
      const resolver = createResolver({ DangerousTool: { defaultRisk: 'critical' } });
      const engine = new PermissionEngine(config, store, resolver);

      const decision = engine.evaluate('DangerousTool', {});
      expect(decision.action).toBe('deny');
    });
  });

  // ============ 严格模式 ============

  describe('strict mode', () => {
    it('should allow low risk tools', () => {
      const config = resolveConfig({ mode: 'strict' });
      const store = new PermissionStore();
      const resolver = createResolver({ ReadFile: { defaultRisk: 'low' } });
      const engine = new PermissionEngine(config, store, resolver);

      const decision = engine.evaluate('ReadFile', {});
      expect(decision.action).toBe('allow');
    });

    it('should deny medium risk tools', () => {
      const config = resolveConfig({ mode: 'strict' });
      const store = new PermissionStore();
      const resolver = createResolver({ Exec: { defaultRisk: 'medium' } });
      const engine = new PermissionEngine(config, store, resolver);

      const decision = engine.evaluate('Exec', {});
      expect(decision.action).toBe('deny');
    });
  });

  // ============ 宽松模式 ============

  describe('permissive mode', () => {
    it('should allow low risk tools', () => {
      const config = resolveConfig({ mode: 'permissive' });
      const store = new PermissionStore();
      const resolver = createResolver({ ReadFile: { defaultRisk: 'low' } });
      const engine = new PermissionEngine(config, store, resolver);

      const decision = engine.evaluate('ReadFile', {});
      expect(decision.action).toBe('allow');
    });

    it('should allow medium risk tools directly', () => {
      const config = resolveConfig({ mode: 'permissive' });
      const store = new PermissionStore();
      const resolver = createResolver({ Exec: { defaultRisk: 'medium' } });
      const engine = new PermissionEngine(config, store, resolver);

      const decision = engine.evaluate('Exec', {});
      expect(decision.action).toBe('allow');
    });

    it('should deny critical risk tools even in permissive mode', () => {
      const config = resolveConfig({ mode: 'permissive' });
      const store = new PermissionStore();
      const resolver = createResolver({ DangerousTool: { defaultRisk: 'critical' } });
      const engine = new PermissionEngine(config, store, resolver);

      const decision = engine.evaluate('DangerousTool', {});
      expect(decision.action).toBe('deny');
    });
  });

  // ============ 拒绝规则 ============

  describe('deny rules', () => {
    it('should deny matching tool', () => {
      const config = resolveConfig({
        mode: 'normal',
        denyRules: [{ action: 'deny', toolPattern: 'Web*', description: 'Web tools blocked' }],
      });
      const store = new PermissionStore();
      const resolver = createResolver({ WebFetch: { defaultRisk: 'medium' } });
      const engine = new PermissionEngine(config, store, resolver);

      const decision = engine.evaluate('WebFetch', {});
      expect(decision.action).toBe('deny');
      expect(decision.matchedRule).toBe('Web*');
    });

    it('should not deny non-matching tool', () => {
      const config = resolveConfig({
        mode: 'normal',
        denyRules: [{ action: 'deny', toolPattern: 'Web*' }],
      });
      const store = new PermissionStore();
      const resolver = createResolver({ ReadFile: { defaultRisk: 'low' } });
      const engine = new PermissionEngine(config, store, resolver);

      const decision = engine.evaluate('ReadFile', {});
      expect(decision.action).toBe('allow');
    });
  });

  // ============ 允许规则 ============

  describe('allow rules', () => {
    it('should allow matching tool', () => {
      const config = resolveConfig({
        mode: 'strict',
        allowRules: [{ action: 'allow', toolPattern: 'Exec' }],
      });
      const store = new PermissionStore();
      const resolver = createResolver({ Exec: { defaultRisk: 'medium' } });
      const engine = new PermissionEngine(config, store, resolver);

      const decision = engine.evaluate('Exec', {});
      expect(decision.action).toBe('allow');
    });
  });

  // ============ Session / Persistent 审批 ============

  describe('session and persistent approvals', () => {
    it('should allow tool with session approval', () => {
      const config = resolveConfig({ mode: 'strict' });
      const store = new PermissionStore();
      store.addSessionApproval('Exec');
      const resolver = createResolver({ Exec: { defaultRisk: 'medium' } });
      const engine = new PermissionEngine(config, store, resolver);

      const decision = engine.evaluate('Exec', {});
      expect(decision.action).toBe('allow');
    });

    it('should allow tool with persistent approval', () => {
      const config = resolveConfig({ mode: 'strict' });
      const store = new PermissionStore({ enabled: true });
      store.addPersistentApproval('WriteFile');
      const resolver = createResolver({ WriteFile: { defaultRisk: 'medium' } });
      const engine = new PermissionEngine(config, store, resolver);

      const decision = engine.evaluate('WriteFile', {});
      expect(decision.action).toBe('allow');
    });
  });

  // ============ 禁用安全 ============

  describe('disabled security', () => {
    it('should allow all tools when disabled', () => {
      const config = resolveConfig({ enabled: false });
      const store = new PermissionStore();
      const resolver = createResolver({ Exec: { defaultRisk: 'critical' } });
      const engine = new PermissionEngine(config, store, resolver);

      const decision = engine.evaluate('Exec', {});
      expect(decision.action).toBe('allow');
      expect(decision.requiresApproval).toBe(false);
    });
  });

  // ============ checkPermission ============

  describe('checkPermission integration', () => {
    it('should use checkPermission result to override defaultRisk', () => {
      const config = resolveConfig({ mode: 'normal' });
      const store = new PermissionStore();
      const resolver = createResolver({
        Exec: {
          defaultRisk: 'medium',
          checkPermission: () => ({
            risk: 'critical',
            requiresApproval: true,
            reason: 'dangerous',
          }),
        },
      });
      const engine = new PermissionEngine(config, store, resolver);

      const decision = engine.evaluate('Exec', { command: 'rm -rf /' });
      expect(decision.action).toBe('deny');
      expect(decision.risk).toBe('critical');
    });
  });
});
