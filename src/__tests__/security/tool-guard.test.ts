/**
 * tool-guard 单元测试
 */
import { describe, expect, it } from 'vitest';
import type { ToolRegistration } from '@/core/agent-runtime';
import { ApprovalManager } from '@/security/approval-manager';
import { resolveConfig } from '@/security/permission-config';
import { PermissionEngine } from '@/security/permission-engine';
import { PermissionStore } from '@/security/permission-store';
import {
  createToolInfoResolver,
  getToolGuardContext,
  runWithToolGuardContext,
  SecurityBlockedError,
  ToolGuard,
} from '@/security/tool-guard';

function makeTool(overrides: Partial<ToolRegistration> = {}): ToolRegistration {
  return {
    id: 'TestTool',
    label: '测试工具',
    description: '用于测试',
    execute: async () => ({
      content: [{ type: 'text', text: 'ok' }],
      details: {},
    }),
    ...overrides,
  };
}

describe('SecurityBlockedError', () => {
  it('should create error with correct properties', () => {
    const err = new SecurityBlockedError('blocked', 'Exec', 'critical', '危险命令');
    expect(err.name).toBe('SecurityBlockedError');
    expect(err.toolId).toBe('Exec');
    expect(err.risk).toBe('critical');
    expect(err.reason).toBe('危险命令');
    expect(err.message).toBe('blocked');
  });
});

describe('ToolGuard', () => {
  describe('wrap - normal mode', () => {
    it('should allow low risk tools to execute', async () => {
      const config = resolveConfig({ mode: 'normal' });
      const store = new PermissionStore();
      const tool = makeTool({ id: 'ReadFile', defaultRisk: 'low' });
      const resolver = createToolInfoResolver([tool]);
      const engine = new PermissionEngine(config, store, resolver);
      const approvalManager = new ApprovalManager();
      const guard = new ToolGuard(engine, approvalManager, store);

      const guarded = guard.wrap(tool);
      const result = await guarded.execute('test-id', {});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result.content[0] as any).text).toBe('ok');
    });

    it('should ask for medium risk tools (auto-deny without provider)', async () => {
      const config = resolveConfig({ mode: 'normal' });
      const store = new PermissionStore();
      const tool = makeTool({ id: 'Exec', defaultRisk: 'medium' });
      const resolver = createToolInfoResolver([tool]);
      const engine = new PermissionEngine(config, store, resolver);
      const approvalManager = new ApprovalManager(); // no provider
      const guard = new ToolGuard(engine, approvalManager, store);

      const guarded = guard.wrap(tool);
      await expect(guarded.execute('test-id', { command: 'ls' })).rejects.toThrow(
        SecurityBlockedError
      );
    });

    it('should allow tool when provider approves', async () => {
      const config = resolveConfig({ mode: 'normal' });
      const store = new PermissionStore();
      const tool = makeTool({ id: 'Exec', defaultRisk: 'medium' });
      const resolver = createToolInfoResolver([tool]);
      const engine = new PermissionEngine(config, store, resolver);
      const approvalManager = new ApprovalManager({
        requestApproval: async () => ({ approved: true, scope: 'once' }),
      });
      const guard = new ToolGuard(engine, approvalManager, store);

      const guarded = guard.wrap(tool);
      const result = await guarded.execute('test-id', { command: 'ls' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result.content[0] as any).text).toBe('ok');
    });

    it('should deny critical tools', async () => {
      const config = resolveConfig({ mode: 'normal' });
      const store = new PermissionStore();
      const tool = makeTool({ id: 'DangerousTool', defaultRisk: 'critical' });
      const resolver = createToolInfoResolver([tool]);
      const engine = new PermissionEngine(config, store, resolver);
      const approvalManager = new ApprovalManager();
      const guard = new ToolGuard(engine, approvalManager, store);

      const guarded = guard.wrap(tool);
      await expect(guarded.execute('test-id', {})).rejects.toThrow(SecurityBlockedError);
    });

    it('should store session approval when scope is session', async () => {
      const config = resolveConfig({ mode: 'normal' });
      const store = new PermissionStore();
      const tool = makeTool({ id: 'Exec', defaultRisk: 'medium' });
      const resolver = createToolInfoResolver([tool]);
      const engine = new PermissionEngine(config, store, resolver);
      const approvalManager = new ApprovalManager({
        requestApproval: async () => ({ approved: true, scope: 'session' }),
      });
      const guard = new ToolGuard(engine, approvalManager, store);

      const guarded = guard.wrap(tool);
      await guarded.execute('test-id', { command: 'ls' });

      // 此后该工具应该被会话级审批允许
      expect(store.hasSessionApproval('Exec')).toBe(true);
    });

    it('should deny when provider rejects', async () => {
      const config = resolveConfig({ mode: 'normal' });
      const store = new PermissionStore();
      const tool = makeTool({ id: 'Exec', defaultRisk: 'medium' });
      const resolver = createToolInfoResolver([tool]);
      const engine = new PermissionEngine(config, store, resolver);
      const approvalManager = new ApprovalManager({
        requestApproval: async () => ({ approved: false }),
      });
      const guard = new ToolGuard(engine, approvalManager, store);

      const guarded = guard.wrap(tool);
      await expect(guarded.execute('test-id', { command: 'rm' })).rejects.toThrow(
        SecurityBlockedError
      );
    });
  });

  describe('wrapAll', () => {
    it('should wrap multiple tools', () => {
      const config = resolveConfig({ mode: 'normal' });
      const store = new PermissionStore();
      const tools = [
        makeTool({ id: 'ReadFile', defaultRisk: 'low' }),
        makeTool({ id: 'WriteFile', defaultRisk: 'medium' }),
      ];
      const resolver = createToolInfoResolver(tools);
      const engine = new PermissionEngine(config, store, resolver);
      const approvalManager = new ApprovalManager();
      const guard = new ToolGuard(engine, approvalManager, store);

      const wrapped = guard.wrapAll(tools);
      expect(wrapped).toHaveLength(2);
      // 验证是代理（保留原属性）
      expect(wrapped[0]!.id).toBe('ReadFile');
      expect(wrapped[1]!.id).toBe('WriteFile');
    });
  });

  describe('createToolInfoResolver', () => {
    it('should resolve tool info', () => {
      const tools = [
        makeTool({ id: 'ReadFile', defaultRisk: 'low' }),
        makeTool({ id: 'Exec', defaultRisk: 'medium' }),
      ];
      const resolver = createToolInfoResolver(tools);

      expect(resolver('ReadFile')?.defaultRisk).toBe('low');
      expect(resolver('Exec')?.defaultRisk).toBe('medium');
      expect(resolver('UnknownTool')).toBeUndefined();
    });
  });
});

describe('ToolGuardContext', () => {
  it('should return undefined when no context is set', () => {
    expect(getToolGuardContext()).toBeUndefined();
  });

  it('should pass context to the callback', async () => {
    const ctx = { isBackgroundAgent: true, planMode: false };
    let capturedCtx: unknown;

    await runWithToolGuardContext(ctx, () => {
      capturedCtx = getToolGuardContext();
      return Promise.resolve();
    });

    expect(capturedCtx).toEqual(ctx);
  });

  it('should restore previous context after callback', async () => {
    const outerCtx = { isBackgroundAgent: false };
    const innerCtx = { isBackgroundAgent: true };

    let afterOuterCtx: unknown;
    let innerCtx_: unknown;

    await runWithToolGuardContext(outerCtx, async () => {
      await runWithToolGuardContext(innerCtx, () => {
        innerCtx_ = getToolGuardContext();
        return Promise.resolve();
      });
      afterOuterCtx = getToolGuardContext();
    });

    expect(innerCtx_).toEqual(innerCtx);
    expect(afterOuterCtx).toEqual(outerCtx);
    expect(getToolGuardContext()).toBeUndefined();
  });

  it('should return value from callback', async () => {
    const result = await runWithToolGuardContext({ isBackgroundAgent: true }, () => 'result-value');
    expect(result).toBe('result-value');
  });
});

describe('ToolGuard with background agent context', () => {
  it('should downgrade ASK to DENY when isBackgroundAgent is set', async () => {
    const config = resolveConfig({ mode: 'normal' });
    const store = new PermissionStore();
    const tool = makeTool({ id: 'Exec', defaultRisk: 'medium' });
    const resolver = createToolInfoResolver([tool]);
    const engine = new PermissionEngine(config, store, resolver);
    // 无审批提供者 → medium 风险工具会进入 ASK 流程
    const approvalManager = new ApprovalManager();
    const guard = new ToolGuard(engine, approvalManager, store);

    const guarded = guard.wrap(tool);

    await expect(
      runWithToolGuardContext({ isBackgroundAgent: true }, () =>
        guarded.execute('test-id', { command: 'ls' })
      )
    ).rejects.toThrow(SecurityBlockedError);
  });

  it('should not affect low risk tools in background agent context', async () => {
    const config = resolveConfig({ mode: 'normal' });
    const store = new PermissionStore();
    const tool = makeTool({ id: 'ReadFile', defaultRisk: 'low' });
    const resolver = createToolInfoResolver([tool]);
    const engine = new PermissionEngine(config, store, resolver);
    const approvalManager = new ApprovalManager();
    const guard = new ToolGuard(engine, approvalManager, store);

    const guarded = guard.wrap(tool);

    const result = await runWithToolGuardContext({ isBackgroundAgent: true }, () =>
      guarded.execute('test-id', {})
    );
    // Low risk tools should still be allowed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result.content[0] as any).text).toBe('ok');
  });

  it('should still deny critical tools in background agent context', async () => {
    const config = resolveConfig({ mode: 'normal' });
    const store = new PermissionStore();
    const tool = makeTool({ id: 'DangerousTool', defaultRisk: 'critical' });
    const resolver = createToolInfoResolver([tool]);
    const engine = new PermissionEngine(config, store, resolver);
    const approvalManager = new ApprovalManager();
    const guard = new ToolGuard(engine, approvalManager, store);

    const guarded = guard.wrap(tool);

    await expect(
      runWithToolGuardContext({ isBackgroundAgent: true }, () => guarded.execute('test-id', {}))
    ).rejects.toThrow(SecurityBlockedError);
  });
});
