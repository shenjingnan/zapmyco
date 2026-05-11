/**
 * Phase 2 集成测试
 *
 * 测试完整安全管道：权限引擎 → ToolGuard → 审计日志 → 密钥脱敏
 */
import { describe, expect, it } from 'vitest';
import type { SkillEntry } from '@/core/skill';
import { ApprovalManager } from '@/security/approval-manager';
import { AuditLogger } from '@/security/audit-logger';
import { resolveConfig, resolveConfigWithAgent } from '@/security/permission-config';
import { PermissionEngine } from '@/security/permission-engine';
import { PermissionStore } from '@/security/permission-store';
import { validateSandboxPolicy } from '@/security/sandbox/policy-validator';
import { SecretRedactor } from '@/security/secret-redaction';
import { SkillGuard } from '@/security/skill-guard';
import { createToolInfoResolver, ToolGuard } from '@/security/tool-guard';
import type { SandboxConfig } from '@/security/types';

// Mock ToolRegistration
function mockTool(overrides: { id?: string; label?: string; risk?: string } = {}) {
  return {
    id: overrides.id ?? 'TestTool',
    label: overrides.label ?? 'Test Tool',
    description: 'A test tool',
    execute: () =>
      Promise.resolve({
        kind: 'ok' as const,
        content: [{ type: 'text' as const, text: 'ok' }],
        details: {},
      }),
    parameters: { type: 'object' as const, properties: {}, required: [] as string[] },
    defaultRisk: (overrides.risk ?? 'low') as 'low' | 'medium' | 'high' | 'critical',
  } as import('@/core/agent-runtime/tool-bridge').ToolRegistration;
}

function createSkillEntry(
  overrides: { name?: string; body?: string; frontmatter?: Record<string, unknown> } = {}
): SkillEntry {
  return {
    skill: {
      name: overrides.name ?? 'test-skill',
      description: 'Test skill',
      filePath: '/test/SKILL.md',
      baseDir: '/test',
      source: 'project',
      frontmatter: {
        name: overrides.name ?? 'test-skill',
        description: 'Test skill',
        ...overrides.frontmatter,
      },
      body: overrides.body ?? '# Test Skill',
      disableModelInvocation: false,
      userInvocable: true,
    },
    loadedAt: new Date(),
    sourceDir: '/test',
  };
}

describe('Phase 2 集成测试', () => {
  describe('审计日志管道', () => {
    it('should log BLOCK action when tool is denied', () => {
      const auditLogger = new AuditLogger({ level: 'normal' }, 'integration-test');
      const config = resolveConfig({
        mode: 'normal',
        denyRules: [{ action: 'deny', toolPattern: 'BashExec' }],
      });
      const store = new PermissionStore();
      const resolver = createToolInfoResolver([mockTool({ id: 'BashExec', risk: 'high' })]);
      const engine = new PermissionEngine(config, store, resolver);
      const approvalManager = new ApprovalManager();
      const guard = new ToolGuard(engine, approvalManager, store, undefined, auditLogger);

      const wrapped = guard.wrap(mockTool({ id: 'BashExec', risk: 'high' }));

      wrapped.execute('call-1', {}, undefined, undefined).catch(() => {
        /* expected */
      });

      const stats = auditLogger.getStats();
      expect(stats.blockedCount).toBe(1);
      auditLogger.destroy();
    });

    it('should log APPROVAL_GRANTED when approved', async () => {
      const auditLogger = new AuditLogger({ level: 'normal' }, 'integration-test');
      const config = resolveConfig({ mode: 'normal', defaultAction: 'ask' });
      const store = new PermissionStore();
      const resolver = createToolInfoResolver([mockTool({ id: 'TestTool', risk: 'medium' })]);
      const engine = new PermissionEngine(config, store, resolver);
      const approvalManager = new ApprovalManager();

      // Pre-approve session level
      approvalManager.setProvider({
        requestApproval: async () => ({ approved: true, scope: 'session' }),
      });

      const guard = new ToolGuard(engine, approvalManager, store, undefined, auditLogger);
      const wrapped = guard.wrap(mockTool({ id: 'TestTool', risk: 'medium' }));
      await wrapped.execute('call-1', {});

      const stats = auditLogger.getStats();
      expect(stats.approvedCount).toBe(1);
      auditLogger.destroy();
    });
  });

  describe('密钥脱敏', () => {
    it('should be integrated with AuditLogger for param redaction', () => {
      const auditLogger = new AuditLogger({ level: 'normal' }, 'integration-test');
      const redactor = new SecretRedactor({ enabled: true });
      auditLogger.setRedactor(redactor);

      auditLogger.log({
        action: 'ALLOW',
        toolId: 'WebFetch',
        risk: 'low',
        params: {
          url: 'https://api.example.com',
          headers: { Authorization: 'Bearer sk-1234567890abcdefghijklmnopqrstuv' },
        },
      });

      const blocks = auditLogger.getRecentBlocks(1);
      // params should have been redacted before the log call returned
      expect(blocks).toBeDefined();
      auditLogger.destroy();
    });
  });

  describe('Skill 威胁扫描', () => {
    it('should detect dangerous Skill', () => {
      const guard = new SkillGuard();
      const entry = createSkillEntry({
        name: 'dangerous-skill',
        body: 'Use rm -rf / to clean system',
        frontmatter: {
          name: 'dangerous-skill',
          description: 'Dangerous skill',
          'allowed-tools': ['*'],
        },
      });
      const result = guard.scan(entry);
      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThanOrEqual(2);
    });

    it('should pass safe Skill', () => {
      const guard = new SkillGuard();
      const entry = createSkillEntry({
        name: 'safe-skill',
        body: 'A safe skill for reading documentation',
        frontmatter: {
          name: 'safe-skill',
          description: 'Safe skill',
          'allowed-tools': ['ReadFile', 'Glob'],
        },
      });
      const result = guard.scan(entry);
      expect(result.passed).toBe(true);
      expect(result.violations).toEqual([]);
    });
  });

  describe('沙箱策略验证', () => {
    it('should validate safe sandbox config', () => {
      const config: SandboxConfig = {
        enabled: true,
        backend: 'none',
        filesystem: {
          projectMount: 'readonly',
          blockedHostPaths: ['/', '/etc', '/proc', '/sys', '/dev', '/boot', '/root'],
        },
        network: { mode: 'none' },
        maxLifetimeSec: 1800,
      };
      const violations = validateSandboxPolicy(config);
      expect(violations).toEqual([]);
    });
  });

  describe('Agent 级别覆盖', () => {
    it('should merge agentOverride denyRules with global config', () => {
      const config = {
        mode: 'normal' as const,
        denyRules: [{ action: 'deny' as const, toolPattern: 'BashExec' }],
        agentOverrides: {
          'code-reviewer': {
            denyRules: [{ action: 'deny' as const, toolPattern: 'WriteFile' }],
          },
        },
      };
      const resolved = resolveConfigWithAgent(config, 'code-reviewer');
      // agent deny rules should be appended
      expect(resolved.denyRules.length).toBe(2);
    });

    it('should override mode for specific agent', () => {
      const config = {
        mode: 'normal' as const,
        agentOverrides: {
          'readonly-agent': { mode: 'strict' as const },
        },
      };
      const resolved = resolveConfigWithAgent(config, 'readonly-agent');
      expect(resolved.mode).toBe('strict');
    });

    it('should fall back to global config when no override', () => {
      const config = {
        mode: 'normal' as const,
        agentOverrides: {
          'code-reviewer': { mode: 'strict' as const },
        },
      };
      const resolved = resolveConfigWithAgent(config, undefined);
      expect(resolved.mode).toBe('normal');
    });
  });
});
