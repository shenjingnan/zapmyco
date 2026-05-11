/**
 * approval-manager 单元测试
 */
import { describe, expect, it } from 'vitest';
import { ApprovalManager } from '@/security/approval-manager';

describe('ApprovalManager', () => {
  describe('without provider', () => {
    it('should auto-deny when no provider set', async () => {
      const manager = new ApprovalManager();
      const response = await manager.requestApproval({
        toolId: 'Exec',
        toolLabel: '执行命令',
        params: { command: 'ls' },
        risk: 'medium',
        reason: '需要审批',
        sessionId: 'test',
      });
      expect(response.approved).toBe(false);
    });

    it('should report no provider', () => {
      const manager = new ApprovalManager();
      expect(manager.hasProvider()).toBe(false);
    });
  });

  describe('with provider', () => {
    it('should use provider when available', async () => {
      const manager = new ApprovalManager({
        requestApproval: async () => ({ approved: true, scope: 'once' }),
      });
      expect(manager.hasProvider()).toBe(true);

      const response = await manager.requestApproval({
        toolId: 'Exec',
        toolLabel: '执行命令',
        params: {},
        risk: 'medium',
        reason: '需要审批',
        sessionId: 'test',
      });
      expect(response.approved).toBe(true);
      expect(response.scope).toBe('once');
    });

    it('should handle provider rejection', async () => {
      const manager = new ApprovalManager({
        requestApproval: async () => ({ approved: false }),
      });

      const response = await manager.requestApproval({
        toolId: 'Exec',
        toolLabel: '执行命令',
        params: {},
        risk: 'high',
        reason: '危险操作',
        sessionId: 'test',
      });
      expect(response.approved).toBe(false);
    });

    it('should handle session scope', async () => {
      const manager = new ApprovalManager({
        requestApproval: async () => ({ approved: true, scope: 'session' }),
      });

      const response = await manager.requestApproval({
        toolId: 'WriteFile',
        toolLabel: '写入文件',
        params: {},
        risk: 'medium',
        reason: '',
        sessionId: 'test',
      });
      expect(response.scope).toBe('session');
    });

    it('should set provider after construction', () => {
      const manager = new ApprovalManager();
      expect(manager.hasProvider()).toBe(false);

      manager.setProvider({
        requestApproval: async () => ({ approved: true }),
      });
      expect(manager.hasProvider()).toBe(true);
    });
  });
});
