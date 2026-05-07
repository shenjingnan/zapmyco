/**
 * zapmyco 日志系统
 *
 * 提供结构化的日志输出，支持不同级别和格式化。
 * 支持将日志写入文件，在 TUI 模式下可抑制终端输出。
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
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
      appendFileSync(this.output.logFilePath, `${output}\n`, 'utf-8');
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
}

export { Logger };
