/**
 * AI 原生 TypeScript 启动模板
 * 专为 AI 辅助开发时代打造
 */

import denoJson from '../deno.json' with { type: 'json' };

/** 当前库的版本号 */
export const VERSION: string = denoJson.version;

/**
 * 配置选项
 */
export interface ConfigOptions {
  /** 是否启用调试模式 */
  debug?: boolean;
  /** 日志级别 */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * 配置对象
 */
export interface Config {
  /** 是否启用调试模式 */
  readonly debug: boolean;
  /** 日志级别 */
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** 创建时间 */
  readonly createdAt: Date;
}

/**
 * 向指定名称打招呼
 * @param name - 要打招呼的名称
 * @returns 打招呼的字符串
 * @throws {TypeError} 当 name 为空字符串时
 * @example
 * ```typescript
 * const message = greet('World');
 * console.log(message); // "Hello, World!"
 * ```
 */
export function greet(name: string): string {
  if (name.length === 0) {
    throw new TypeError('name cannot be empty');
  }
  return `Hello, ${name}!`;
}

/**
 * 创建配置对象
 * @param options - 可选的配置选项
 * @returns 配置对象
 * @example
 * ```typescript
 * const config = createConfig({ debug: true });
 * console.log(config.debug); // true
 * ```
 */
export function createConfig(options?: ConfigOptions): Config {
  const { debug = false, logLevel = 'info' } = options ?? {};
  return {
    debug,
    logLevel,
    createdAt: new Date(),
  };
}

/**
 * CLI 执行结果
 */
export interface CliResult {
  /** 退出码 */
  exitCode: number;
  /** 标准输出 */
  stdout: string;
  /** 错误输出 */
  stderr: string;
}

/**
 * CLI 入口 - 解析参数并执行对应操作
 * @param args - 命令行参数数组
 * @returns CLI 执行结果
 */
export function cli(args: string[]): CliResult {
  const [command, ...rest] = args;

  if (command === 'greet') {
    const name = rest[0];
    if (!name) {
      return { exitCode: 1, stdout: '', stderr: '请指定名称' };
    }
    return { exitCode: 0, stdout: greet(name), stderr: '' };
  }

  if (command === 'config') {
    return {
      exitCode: 0,
      stdout: JSON.stringify(createConfig(), null, 2),
      stderr: '',
    };
  }

  if (command === '--version' || command === '-v' || command === '-V') {
    return { exitCode: 0, stdout: `v${VERSION}`, stderr: '' };
  }

  const helpText = [
    `ZapMyCo v${VERSION}`,
    '',
    '用法:',
    '  greet <name>     向指定名称打招呼',
    '  config           显示配置信息',
    '  --version, -v, -V  显示版本号',
    '  --help, -h       显示帮助信息',
  ].join('\n');

  if (!command || command === '--help' || command === '-h') {
    return { exitCode: 0, stdout: helpText, stderr: '' };
  }

  return {
    exitCode: 1,
    stdout: '',
    stderr: `未知命令: ${command}\n${helpText}`,
  };
}

if (import.meta.main) {
  const result = cli(Deno.args);
  if (result.stderr) console.error(result.stderr);
  if (result.stdout) console.log(result.stdout);
  Deno.exit(result.exitCode);
}

// 默认导出
export default {
  greet,
  createConfig,
  VERSION,
};
