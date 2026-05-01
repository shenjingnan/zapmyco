/**
 * 后台进程注册表
 *
 * 管理后台运行的子进程生命周期：注册、轮询、日志、终止、TTL 清理。
 * 参考 Hermes (process_registry.py) 和 OpenClaw (bash-process-registry.ts) 的设计。
 *
 * @module cli/repl/tools/process-registry
 */

import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { ProcessSession } from './shell-types';

// ============ 常量 ============

/** 每个进程最大输出字符数 */
const MAX_OUTPUT_CHARS = 200_000;
/** 日志预览尾部行数 */
const LOG_TAIL_LINES = 40;
/** 默认 TTL（30 分钟），超时自动清理 */
const DEFAULT_TTL_MS = 30 * 60 * 1000;
/** 清理间隔 */
const CLEANUP_INTERVAL_MS = 60_000;

// ============ 内部记录类型 ============

interface ProcessRecord {
  session: ProcessSession;
  childProcess: ChildProcess;
  stdoutChunks: string[];
  stderrChunks: string[];
  totalOutputSize: number;
  onComplete?: (session: ProcessSession) => void;
}

// ============ ProcessRegistry 实现 ============

export class ProcessRegistry {
  private processes = new Map<string, ProcessRecord>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * 注册新的后台进程
   */
  register(
    command: string,
    childProcess: ChildProcess,
    options?: {
      workdir?: string;
      onComplete?: (session: ProcessSession) => void;
    }
  ): ProcessSession {
    const sessionId = `proc_${randomBytes(6).toString('hex')}`;
    const session: ProcessSession = {
      sessionId,
      command,
      pid: childProcess.pid ?? 0,
      status: 'running',
      startTime: Date.now(),
    };
    if (options?.workdir !== undefined) {
      session.workdir = options.workdir;
    }

    const record: ProcessRecord = {
      session,
      childProcess,
      stdoutChunks: [],
      stderrChunks: [],
      totalOutputSize: 0,
    };
    if (options?.onComplete !== undefined) {
      record.onComplete = options.onComplete;
    }

    // 监听数据输出
    if (childProcess.stdout) {
      childProcess.stdout.on('data', (data: Buffer) => {
        this.appendOutput(record, data.toString('utf-8'));
      });
    }
    if (childProcess.stderr) {
      childProcess.stderr.on('data', (data: Buffer) => {
        this.appendOutput(record, data.toString('utf-8'));
      });
    }

    // 监听进程退出
    childProcess.on('exit', (code, signal) => {
      session.endTime = Date.now();
      session.exitCode = code;
      session.signal = signal;

      if (session.status === 'running') {
        if (code === 0 || code === null) {
          session.status = 'exited';
        } else if (signal && ['SIGTERM', 'SIGKILL', 'SIGINT'].includes(signal)) {
          session.status = 'killed';
        } else {
          session.status = 'exited';
        }
      }

      record.onComplete?.(session);
    });

    childProcess.on('error', (_err) => {
      if (session.status === 'running') {
        session.status = 'errored';
        session.endTime = Date.now();
      }
      record.onComplete?.(session);
    });

    this.processes.set(sessionId, record);
    this.ensureCleanupTimer();

    return session;
  }

  /**
   * 列出所有进程
   */
  list(): ProcessSession[] {
    const sessions: ProcessSession[] = [];
    for (const record of this.processes.values()) {
      sessions.push({ ...record.session });
    }
    return sessions.sort((a, b) => b.startTime - a.startTime);
  }

  /**
   * 轮询进程状态（返回新输出）
   */
  poll(sessionId: string): {
    session: ProcessSession;
    newOutput: string;
  } | null {
    const record = this.processes.get(sessionId);
    if (!record) return null;

    const newOutput = record.stdoutChunks.join('');
    record.stdoutChunks = [];

    return {
      session: { ...record.session },
      newOutput,
    };
  }

  /**
   * 获取进程完整日志
   */
  getLog(
    sessionId: string,
    options?: { offset?: number; limit?: number }
  ): { session: ProcessSession; output: string } | null {
    const record = this.processes.get(sessionId);
    if (!record) return null;

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? LOG_TAIL_LINES;

    // 合并所有输出
    const fullOutput = this.getAllOutput(record);
    const lines = fullOutput.split('\n');
    const sliced = lines.slice(offset, offset + limit);

    return {
      session: { ...record.session },
      output: sliced.join('\n'),
    };
  }

  /**
   * 等待进程完成
   */
  wait(sessionId: string, timeoutMs?: number): Promise<ProcessSession | null> {
    const record = this.processes.get(sessionId);
    if (!record) return Promise.resolve(null);

    if (record.session.status !== 'running') {
      return Promise.resolve({ ...record.session });
    }

    return new Promise((resolve) => {
      const timeout = timeoutMs
        ? setTimeout(() => {
            resolve({ ...record.session });
          }, timeoutMs)
        : null;

      const originalHandler = record.onComplete;
      record.onComplete = (session) => {
        originalHandler?.(session);
        if (timeout) clearTimeout(timeout);
        resolve({ ...session });
      };
    });
  }

  /**
   * 终止进程（先 SIGTERM，2 秒后 SIGKILL）
   */
  kill(sessionId: string): ProcessSession | null {
    const record = this.processes.get(sessionId);
    if (!record) return null;

    if (record.session.status !== 'running') {
      return { ...record.session };
    }

    // 发送 SIGTERM
    record.childProcess.kill('SIGTERM');
    record.session.status = 'killed';

    // 2 秒后强制 SIGKILL
    setTimeout(() => {
      if (record.childProcess.exitCode === null) {
        try {
          record.childProcess.kill('SIGKILL');
        } catch {
          // 进程可能已经退出
        }
      }
    }, 2000);

    return { ...record.session };
  }

  /**
   * 向进程 stdin 写入数据
   */
  write(sessionId: string, data: string, newline: boolean): ProcessSession | null {
    const record = this.processes.get(sessionId);
    if (!record) return null;

    if (record.session.status !== 'running') {
      return { ...record.session };
    }

    if (record.childProcess.stdin && !record.childProcess.stdin.destroyed) {
      record.childProcess.stdin.write(data);
      if (newline) {
        record.childProcess.stdin.write('\n');
      }
    }

    return { ...record.session };
  }

  /**
   * 移除进程记录（清理已完成进程）
   */
  remove(sessionId: string): boolean {
    return this.processes.delete(sessionId);
  }

  /**
   * 获取所有已完成的进程 session ID
   */
  getCompletedSessionIds(): string[] {
    const ids: string[] = [];
    for (const [id, record] of this.processes) {
      if (record.session.status !== 'running') {
        ids.push(id);
      }
    }
    return ids;
  }

  /**
   * 获取进程数
   */
  get count(): number {
    return this.processes.size;
  }

  /**
   * 销毁注册表（清理所有进程）
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    for (const record of this.processes.values()) {
      if (record.session.status === 'running') {
        try {
          record.childProcess.kill('SIGKILL');
        } catch {
          // 忽略
        }
      }
    }
    this.processes.clear();
  }

  // ============ 私有方法 ============

  private appendOutput(record: ProcessRecord, data: string): void {
    if (record.totalOutputSize >= MAX_OUTPUT_CHARS) return;

    const remaining = MAX_OUTPUT_CHARS - record.totalOutputSize;
    const chunk = data.length > remaining ? data.slice(0, remaining) : data;

    record.stdoutChunks.push(chunk);
    record.totalOutputSize += chunk.length;
  }

  private getAllOutput(record: ProcessRecord): string {
    return record.stdoutChunks.join('');
  }

  private ensureCleanupTimer(): void {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, record] of this.processes) {
        if (record.session.status !== 'running') {
          const age = now - (record.session.endTime ?? record.session.startTime);
          if (age > DEFAULT_TTL_MS) {
            this.processes.delete(id);
          }
        }
      }
    }, CLEANUP_INTERVAL_MS);

    // 允许进程退出（不阻止 Node.js 退出）
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }
}

/** 全局单例 */
let globalRegistry: ProcessRegistry | null = null;

/** 获取全局 ProcessRegistry 实例 */
export function getProcessRegistry(): ProcessRegistry {
  if (!globalRegistry) {
    globalRegistry = new ProcessRegistry();
  }
  return globalRegistry;
}
