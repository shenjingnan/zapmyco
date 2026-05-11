/**
 * audit-logger 单元测试
 */
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AuditLogger } from '@/security/audit-logger';
import { SecretRedactor } from '@/security/secret-redaction';

const AUDIT_FILE = join(homedir(), '.zapmyco', 'logs', 'audit.jsonl');

function cleanup(): void {
  try {
    if (existsSync(AUDIT_FILE)) unlinkSync(AUDIT_FILE);
  } catch {
    /* ignore */
  }
}

describe('AuditLogger', () => {
  afterEach(() => {
    cleanup();
  });

  describe('constructor and configuration', () => {
    it('should create an AuditLogger with default config', () => {
      const logger = new AuditLogger();
      expect(logger).toBeDefined();
      logger.destroy();
    });

    it('should create directory if not exists', () => {
      const logger = new AuditLogger();
      expect(existsSync(join(homedir(), '.zapmyco', 'logs'))).toBe(true);
      logger.destroy();
    });

    it('should accept custom sessionId', () => {
      const logger = new AuditLogger({ level: 'normal' }, 'test-session');
      logger.destroy();
    });
  });

  describe('log()', () => {
    it('should buffer entries and write on flush', async () => {
      const logger = new AuditLogger({ level: 'normal' }, 'test-session');
      logger.log({ action: 'ALLOW', toolId: 'ReadFile', risk: 'low' });
      logger.log({ action: 'BLOCK', toolId: 'Bash', risk: 'high', reason: 'denied by rule' });
      logger.destroy();

      expect(existsSync(AUDIT_FILE)).toBe(true);
    });

    it('should record JSONL format correctly', () => {
      const logger = new AuditLogger({ level: 'normal' }, 'test-session');
      logger.log({ action: 'ALLOW', toolId: 'ReadFile', risk: 'low' });
      logger.destroy();

      const content = readFileSync(AUDIT_FILE, 'utf-8').trim();
      const entry = JSON.parse(content.split('\n')[0]!);
      expect(entry.action).toBe('ALLOW');
      expect(entry.toolId).toBe('ReadFile');
      expect(entry.risk).toBe('low');
      expect(entry.sessionId).toBe('test-session');
      expect(entry.timestamp).toBeDefined();
    });

    it('should skip non-critical events in silent mode', () => {
      const logger = new AuditLogger({ level: 'silent' }, 'test-session');
      logger.log({ action: 'ALLOW', toolId: 'ReadFile', risk: 'low' });
      logger.log({ action: 'BLOCK', toolId: 'Bash', risk: 'high' });
      logger.destroy();

      if (existsSync(AUDIT_FILE)) {
        const content = readFileSync(AUDIT_FILE, 'utf-8').trim();
        const entries = content.split('\n').filter(Boolean);
        for (const entry of entries) {
          const e = JSON.parse(entry);
          expect(e.action).toBe('BLOCK'); // silent mode only records BLOCK
        }
      }
    });
  });

  describe('getStats()', () => {
    it('should return correct statistics', () => {
      const logger = new AuditLogger({ level: 'normal' }, 'test-session');
      logger.log({ action: 'BLOCK', toolId: 'Bash', risk: 'high' });
      logger.log({ action: 'APPROVAL_GRANTED', toolId: 'WriteFile', risk: 'medium' });
      logger.log({ action: 'APPROVAL_DENIED', toolId: 'Exec', risk: 'high' });
      logger.destroy();

      const stats = logger.getStats();
      expect(stats.totalDecisions).toBe(3);
      expect(stats.blockedCount).toBe(1);
      expect(stats.approvedCount).toBe(1);
      expect(stats.deniedCount).toBe(1);
    });
  });

  describe('getRecentBlocks()', () => {
    it('should return recent blocked entries', () => {
      const logger = new AuditLogger({ level: 'normal' }, 'test-session');
      logger.log({
        action: 'BLOCK',
        toolId: 'BashExec',
        risk: 'critical',
        reason: 'dangerous command',
      });
      logger.log({ action: 'ALLOW', toolId: 'ReadFile', risk: 'low' });
      logger.log({ action: 'BLOCK', toolId: 'WriteFile', risk: 'high', reason: 'sensitive path' });
      logger.destroy();

      const blocks = logger.getRecentBlocks(5);
      expect(blocks.every((b) => b.toolId)).toBe(true);
      expect(blocks.length).toBeGreaterThan(0);
    });

    it('should return empty array when no blocks', () => {
      const logger = new AuditLogger({ level: 'normal' }, 'test-session');
      logger.log({ action: 'ALLOW', toolId: 'ReadFile', risk: 'low' });
      logger.destroy();

      const blocks = logger.getRecentBlocks(5);
      expect(blocks).toEqual([]);
    });
  });

  describe('secret redaction integration', () => {
    it('should redact secrets in logged params', () => {
      const logger = new AuditLogger({ level: 'normal' }, 'test-session');
      const redactor = new SecretRedactor({ enabled: true });
      logger.setRedactor(redactor);

      logger.log({
        action: 'ALLOW',
        toolId: 'WebFetch',
        risk: 'low',
        params: { url: 'https://example.com', key: 'sk-proj-1234567890abcdefghij' },
      });
      logger.destroy();

      const content = readFileSync(AUDIT_FILE, 'utf-8');
      expect(content).not.toContain('sk-proj');
      expect(content).toContain('****REDACTED****');
    });
  });

  describe('destroy()', () => {
    it('should flush remaining buffer on destroy', () => {
      const logger = new AuditLogger({ level: 'normal' }, 'test-session');
      logger.log({ action: 'ALLOW', toolId: 'ReadFile', risk: 'low' });
      logger.destroy();

      expect(existsSync(AUDIT_FILE)).toBe(true);
    });
  });
});
