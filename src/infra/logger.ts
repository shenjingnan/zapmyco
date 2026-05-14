/**
 * zapmyco 日志系统
 *
 * 提供结构化的日志输出，支持不同级别和格式化。
 * 支持将日志写入文件，在 TUI 模式下可抑制终端输出。
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ZapmycoError } from '@/infra/errors';

/** 格式化本地时间为 ISO-like 字符串（YYYY-MM-DD HH:MM:SS） */
function formatLocalTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 日志级别 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 日志条目 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
  error?: Error;
}

/** 级别对应的标签（用于终端输出） */
const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
};

/** 级别权重（用于过滤） */
const LEVEL_WEIGHTS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** 日志输出配置（可被子 Logger 共享引用） */
class LogOutput {
  quiet: boolean = false;
  logFilePath: string | null = null;
  maxFileSize: number = 50 * 1024 * 1024; // 50MB 默认
  retentionDays: number = 7; // 7 天默认
  maxRotations: number = 5;
}

/**
 * Logger 实例
 */
class Logger {
  private minLevel: LogLevel;
  private entries: LogEntry[] = [];
  private output: LogOutput;

  constructor(minLevel: LogLevel = 'info', output?: LogOutput) {
    this.minLevel = minLevel;
    this.output = output ?? new LogOutput();
  }

  /** 设置日志级别 */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /** 设置日志文件路径，日志将追加写入该文件 */
  setLogFile(filePath: string): void {
    // 确保父目录存在
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.output.logFilePath = filePath;
  }

  /** 设置是否抑制终端输出（TUI 模式应设为 true） */
  setQuiet(quiet: boolean): void {
    this.output.quiet = quiet;
  }

  /** 设置日志文件轮转大小（字节） */
  setMaxFileSize(bytes: number): void {
    this.output.maxFileSize = bytes;
  }

  /** 设置日志保留天数 */
  setRetentionDays(days: number): void {
    this.output.retentionDays = days;
  }

  /** 创建带前缀的子 logger，共享父 Logger 的输出配置（同一引用，后续修改会反映到所有子 Logger） */
  child(prefix: string): Logger {
    const child = new Logger(this.minLevel, this.output);
    const originalLog = child.log.bind(child);
    child.log = (
      level: LogLevel,
      message: string,
      context?: Record<string, unknown>,
      error?: Error
    ) => {
      originalLog(level, `[${prefix}] ${message}`, context, error);
    };
    return child;
  }

  /** 格式化日志输出文本 */
  private formatOutput(entry: LogEntry): string {
    const timestamp = entry.timestamp.replace('T', ' ').slice(0, 19);
    const label = LEVEL_LABELS[entry.level];
    let output = `${timestamp} [${label}] ${entry.message}`;

    if (entry.context && Object.keys(entry.context).length > 0) {
      output += ` ${JSON.stringify(entry.context)}`;
    }

    const error = entry.error;
    if (error instanceof ZapmycoError) {
      output += ` (${error.code}) ${error.message}`;
    } else if (error) {
      output += ` ${error.message}`;
    }

    return output;
  }

  /** 核心日志方法 */
  log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: Error): void {
    if (LEVEL_WEIGHTS[level] < LEVEL_WEIGHTS[this.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: formatLocalTime(new Date()),
      ...(context !== undefined ? { context } : {}),
      ...(error !== undefined ? { error } : {}),
    };

    this.entries.push(entry);

    const output = this.formatOutput(entry);

    // 写入文件（如果已配置）
    if (this.output.logFilePath) {
      try {
        this.rotateIfNeeded();
        this.cleanOldLogs();
        appendFileSync(this.output.logFilePath, `${output}\n`, 'utf-8');
      } catch {
        // 文件写入失败不抛出，避免影响主流程
      }
    }

    // 终端输出（quiet 模式下抑制）
    if (!this.output.quiet) {
      const stream = level === 'error' ? process.stderr : process.stdout;
      stream.write(`${output}\n`);
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>, error?: Error): void {
    this.log('error', message, context, error);
  }

  /** 基于文件大小轮转日志 */
  private rotateIfNeeded(): void {
    const filePath = this.output.logFilePath;
    if (!filePath) return;
    if (!existsSync(filePath)) return;

    try {
      const stats = statSync(filePath);
      if (stats.size < this.output.maxFileSize) return;

      const dir = dirname(filePath);
      const baseName = filePath.split('/').pop() ?? 'zapmyco.log';

      // 从最旧开始轮转：删除最旧的，其余重命名
      for (let i = this.output.maxRotations - 1; i >= 0; i--) {
        const oldPath = join(dir, `${baseName}.${i}`);
        const newPath = join(dir, `${baseName}.${i + 1}`);
        if (existsSync(oldPath)) {
          if (i === this.output.maxRotations - 1) {
            unlinkSync(oldPath);
          } else {
            renameSync(oldPath, newPath);
          }
        }
      }

      // 轮转当前文件
      renameSync(filePath, join(dir, `${baseName}.0`));
    } catch {
      // 轮转失败不影响正常写入
    }
  }

  /** 清理过期日志文件（基于保留天数） */
  private cleanOldLogs(): void {
    const filePath = this.output.logFilePath;
    if (!filePath) return;

    try {
      const dir = dirname(filePath);
      const baseName = filePath.split('/').pop() ?? 'zapmyco.log';
      const now = Date.now();
      const maxAgeMs = this.output.retentionDays * 24 * 60 * 60 * 1000;

      // 检查当前文件和所有轮转文件
      const filesToCheck = [filePath];
      for (let i = 1; i <= this.output.maxRotations; i++) {
        const rotatedPath = join(dir, `${baseName}.${i}`);
        if (existsSync(rotatedPath)) {
          filesToCheck.push(rotatedPath);
        }
      }

      for (const f of filesToCheck) {
        try {
          const mtime = statSync(f).mtimeMs;
          if (now - mtime > maxAgeMs) {
            unlinkSync(f);
          }
        } catch {
          // 单个文件清理失败不影响其他
        }
      }
    } catch {
      // 清理失败不影响主流程
    }
  }

  /** 获取所有日志条目 */
  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  /** 清空日志条目 */
  clear(): void {
    this.entries = [];
  }
}

/** 全局默认 logger 实例 */
export const logger = new Logger();

/**
 * 配置全局 logger
 *
 * 便捷方法，用于一次性设置日志级别、文件路径和 quiet 模式。
 */
export function configureLogger(options: {
  logFilePath?: string;
  quiet?: boolean;
  level?: LogLevel;
  maxFileSize?: number;
  retentionDays?: number;
}): void {
  if (options.level) {
    logger.setLevel(options.level);
  }
  if (options.logFilePath) {
    logger.setLogFile(options.logFilePath);
  }
  if (options.quiet !== undefined) {
    logger.setQuiet(options.quiet);
  }
  if (options.maxFileSize !== undefined) {
    logger.setMaxFileSize(options.maxFileSize);
  }
  if (options.retentionDays !== undefined) {
    logger.setRetentionDays(options.retentionDays);
  }
}

export { Logger };
