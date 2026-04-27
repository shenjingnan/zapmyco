/**
 * zapmyco 日志系统
 *
 * 提供结构化的日志输出，支持不同级别和格式化。
 */

import { ZapmycoError } from './errors.js';

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

/**
 * Logger 实例
 */
class Logger {
  private minLevel: LogLevel;
  private entries: LogEntry[] = [];

  constructor(minLevel: LogLevel = 'info') {
    this.minLevel = minLevel;
  }

  /** 设置日志级别 */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /** 创建带前缀的子 logger */
  child(prefix: string): Logger {
    const child = new Logger(this.minLevel);
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

  /** 核心日志方法 */
  log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: Error): void {
    if (LEVEL_WEIGHTS[level] < LEVEL_WEIGHTS[this.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(context !== undefined ? { context } : {}),
      ...(error !== undefined ? { error } : {}),
    };

    this.entries.push(entry);

    // 终端输出格式
    const timestamp = entry.timestamp.replace('T', ' ').slice(0, 19);
    const label = LEVEL_LABELS[level];
    let output = `${timestamp} [${label}] ${message}`;

    if (entry.context && Object.keys(entry.context).length > 0) {
      output += ` ${JSON.stringify(entry.context)}`;
    }

    if (error instanceof ZapmycoError) {
      output += ` (${error.code}) ${error.message}`;
    } else if (error) {
      output += ` ${error.message}`;
    }

    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(`${output}\n`);
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

export { Logger };
