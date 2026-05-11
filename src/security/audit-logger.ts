/**
 * 审计日志记录器
 *
 * 将安全决策以 JSONL 格式写入 ~/.zapmyco/logs/audit.jsonl。
 * 支持批量缓冲写入、文件轮转、统计查询。
 *
 * @module security/audit-logger
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { eventBus } from '@/infra/event-bus';
import { logger } from '@/infra/logger';
import type { SecretRedactor } from './secret-redaction';
import type { AuditEntry, AuditLevel } from './types';

const log = logger.child('audit-logger');

/** 默认审计日志目录 */
const AUDIT_DIR = join(homedir(), '.zapmyco', 'logs');
/** 审计日志文件名 */
const AUDIT_FILE = 'audit.jsonl';
/** 缓冲批量写入大小 */
const BATCH_SIZE = 10;
/** 缓冲 flush 间隔（毫秒） */
const FLUSH_INTERVAL_MS = 5000;
/** 最大日志文件大小（字节），超过后轮转 */
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
/** 最大轮转文件数 */
const MAX_ROTATIONS = 5;

export class AuditLogger {
  private level: AuditLevel;
  private sessionId: string;
  private filePath: string;
  private buffer: AuditEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private redactor: SecretRedactor | null = null;
  private violationListener:
    | ((payload: {
        toolId: string;
        type: string;
        message: string;
        params: Record<string, unknown>;
      }) => void)
    | null = null;

  // 内存统计计数器
  private totalDecisions = 0;
  private blockedCount = 0;
  private approvedCount = 0;
  private deniedCount = 0;

  constructor(config?: { enabled?: boolean; level?: AuditLevel }, sessionId?: string) {
    this.level = config?.level ?? 'normal';
    this.sessionId = sessionId ?? `session-${Date.now()}`;
    this.filePath = join(AUDIT_DIR, AUDIT_FILE);

    // 确保日志目录存在
    if (!existsSync(AUDIT_DIR)) {
      mkdirSync(AUDIT_DIR, { recursive: true });
    }

    // 启动定时 flush
    if (config?.enabled !== false) {
      this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    }

    // 监听 security:violation 事件自动记录
    this.violationListener = (payload) => {
      if (this.level !== 'silent') {
        this.log({
          action: 'VIOLATION',
          toolId: payload.toolId,
          reason: payload.message,
          params: payload.params,
        });
      }
    };
    eventBus.on('security:violation', this.violationListener);

    log.debug('审计日志初始化', { path: this.filePath, level: this.level });
  }

  /**
   * 设置密钥脱敏器（用于在 log() 中脱敏 params）
   */
  setRedactor(redactor: SecretRedactor): void {
    this.redactor = redactor;
  }

  /**
   * 记录一条审计事件
   */
  log(entry: Omit<AuditEntry, 'timestamp' | 'sessionId'>): void {
    // silent 模式仅记录 BLOCK 和 VIOLATION
    if (this.level === 'silent' && entry.action !== 'BLOCK' && entry.action !== 'VIOLATION') {
      return;
    }

    const fullEntry: AuditEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
    };

    // 脱敏 params 中的敏感信息
    if (this.redactor && fullEntry.params) {
      fullEntry.params = JSON.parse(
        this.redactor.redact(JSON.stringify(fullEntry.params))
      ) as Record<string, unknown>;
    }

    this.buffer.push(fullEntry);
    this.updateStats(fullEntry);

    // 达到批量大小时立即 flush
    if (this.buffer.length >= BATCH_SIZE) {
      this.flush();
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      totalDecisions: this.totalDecisions,
      blockedCount: this.blockedCount,
      approvedCount: this.approvedCount,
      deniedCount: this.deniedCount,
    };
  }

  /**
   * 获取最近的阻止记录
   */
  getRecentBlocks(limit = 10): Array<{ toolId: string; reason: string; timestamp: string }> {
    const entries = this.readAllEntries();
    return entries
      .filter((e) => e.action === 'BLOCK')
      .slice(-limit)
      .reverse()
      .map((e) => ({
        toolId: e.toolId,
        reason: e.reason ?? '未知',
        timestamp: e.timestamp,
      }));
  }

  /**
   * 读取完整审计日志文件内容
   */
  readAllEntries(): AuditEntry[] {
    try {
      if (!existsSync(this.filePath)) return [];
      const content = readFileSync(this.filePath, 'utf-8');
      return content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AuditEntry);
    } catch {
      log.warn('读取审计日志失败');
      return [];
    }
  }

  /**
   * 销毁监听器并 flush 剩余缓冲
   */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.violationListener) {
      try {
        // eventemitter3 使用 off/removeListener，测试 mock 可能缺少此方法
        const bus = eventBus as unknown as {
          off?: (event: string, fn: (...args: unknown[]) => void) => void;
        };
        bus.off?.('security:violation', this.violationListener as (...args: unknown[]) => void);
      } catch {
        // 忽略 mock 环境缺少 off 方法的情况
      }
      this.violationListener = null;
    }
    this.flush();
    log.debug('审计日志已关闭');
  }

  // ============ 私有方法 ============

  /**
   * 将缓冲写入文件
   */
  private flush(): void {
    if (this.buffer.length === 0) return;

    const entries = this.buffer.splice(0);
    try {
      this.rotateIfNeeded();
      const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
      appendFileSync(this.filePath, lines, 'utf-8');
    } catch (err) {
      log.error('审计日志写入失败', { error: err instanceof Error ? err.message : String(err) });
      // 写入失败时不丢失数据：重新放入缓冲区（但避免无限增长）
      if (this.buffer.length < 1000) {
        this.buffer = [...entries, ...this.buffer];
      }
    }
  }

  /**
   * 更新内存统计计数器
   */
  private updateStats(entry: AuditEntry): void {
    this.totalDecisions++;
    switch (entry.action) {
      case 'BLOCK':
        this.blockedCount++;
        break;
      case 'APPROVAL_GRANTED':
        this.approvedCount++;
        break;
      case 'APPROVAL_DENIED':
        this.deniedCount++;
        break;
    }
  }

  /**
   * 基于文件大小轮转日志
   */
  private rotateIfNeeded(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const stats = statSync(this.filePath);
      if (stats.size < MAX_FILE_SIZE_BYTES) return;

      // 轮转：删除最旧的，其余重命名
      for (let i = MAX_ROTATIONS - 1; i >= 0; i--) {
        const oldPath = join(AUDIT_DIR, `${AUDIT_FILE}.${i}`);
        const newPath = join(AUDIT_DIR, `${AUDIT_FILE}.${i + 1}`);
        if (existsSync(oldPath)) {
          if (i === MAX_ROTATIONS - 1) {
            // 删除最旧的
            const { unlinkSync } = require('node:fs');
            unlinkSync(oldPath);
          } else if (existsSync(newPath)) {
            // 重命名为下一个编号
            const { renameSync } = require('node:fs');
            renameSync(oldPath, newPath);
          }
        }
      }

      // 轮转当前文件
      const { renameSync } = require('node:fs');
      renameSync(this.filePath, join(AUDIT_DIR, `${AUDIT_FILE}.0`));
    } catch {
      // 轮转失败不影响正常写入
    }
  }
}
