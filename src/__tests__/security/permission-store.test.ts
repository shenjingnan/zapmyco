/**
 * permission-store 单元测试
 */
import { describe, expect, it } from 'vitest';
import { PermissionStore } from '@/security/permission-store';

describe('PermissionStore', () => {
  describe('session approvals', () => {
    it('should add and check session approval', () => {
      const store = new PermissionStore();
      store.addSessionApproval('ReadFile');
      expect(store.hasSessionApproval('ReadFile')).toBe(true);
      expect(store.hasSessionApproval('WriteFile')).toBe(false);
    });

    it('should return false for unapproved tool', () => {
      const store = new PermissionStore();
      expect(store.hasSessionApproval('Exec')).toBe(false);
    });

    it('should support hasApproval for session', () => {
      const store = new PermissionStore();
      store.addSessionApproval('Glob');
      expect(store.hasApproval('Glob')).toBe(true);
    });
  });

  describe('persistent approvals', () => {
    it('should add and check persistent approval', () => {
      const store = new PermissionStore({ enabled: true });
      store.addPersistentApproval('WebFetch');
      expect(store.hasPersistentApproval('WebFetch')).toBe(true);
    });

    it('should not persist when disabled', () => {
      const store = new PermissionStore({ enabled: false });
      store.addPersistentApproval('WebFetch');
      expect(store.hasPersistentApproval('WebFetch')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all approvals', () => {
      const store = new PermissionStore();
      store.addSessionApproval('ReadFile');
      store.addPersistentApproval('Glob');
      store.clear();
      expect(store.hasSessionApproval('ReadFile')).toBe(false);
      expect(store.hasPersistentApproval('Glob')).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return counts', () => {
      const store = new PermissionStore();
      store.addSessionApproval('ReadFile');
      store.addSessionApproval('Glob');
      const stats = store.getStats();
      expect(stats.sessionCount).toBe(2);
      expect(stats.persistentCount).toBe(0);
    });
  });
});
