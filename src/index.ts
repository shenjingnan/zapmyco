/**
 * AI 原生 TypeScript 启动模板
 * 专为 AI 辅助开发时代打造
 */

import denoJson from '../deno.json' with { type: 'json' };
import { AiAgent } from './ai-agent.ts';

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

function getSettingsPath(): string {
  return `${Deno.env.get('HOME') ?? '.'}/.zapmyco/settings.json`;
}

async function promptUser(question: string): Promise<string> {
  const encoder = new TextEncoder();
  Deno.stdout.writeSync(encoder.encode(question));
  const buf = new Uint8Array(1024);
  const n = await Deno.stdin.read(buf);
  if (n === null) return '';
  return new TextDecoder().decode(buf.subarray(0, n)).trim();
}

function getSettingsDir(): string {
  return `${Deno.env.get('HOME') ?? '.'}/.zapmyco`;
}

async function handleInitCommand(): Promise<CliResult> {
  const filePath = getSettingsPath();
  const dir = getSettingsDir();

  // 检查是否已存在
  try {
    Deno.statSync(filePath);
    return {
      exitCode: 1,
      stdout: '',
      stderr: `${filePath} 已存在。如需重新初始化，请先删除该文件。`,
    };
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      return { exitCode: 1, stdout: '', stderr: String(err) };
    }
  }

  // 交互式询问 API Key
  const apiKey = await promptUser(
    '? DeepSeek API Key（输入密钥，或直接回车使用环境变量 DEEPSEEK_API_KEY）: ',
  );

  // 写入配置文件（新结构）
  const settings = {
    llm: {
      providers: {
        deepseek: {
          apiKey: apiKey || '${env.DEEPSEEK_API_KEY}',
        },
      },
      models: {
        advanced: 'deepseek-reasoner',
        default: 'deepseek-v4-flash',
        light: 'deepseek-v4-flash',
      },
    },
  };

  try {
    Deno.mkdirSync(dir, { recursive: true });
    Deno.writeTextFileSync(filePath, JSON.stringify(settings, null, 2) + '\n');
  } catch (error) {
    return { exitCode: 1, stdout: '', stderr: String(error) };
  }

  return {
    exitCode: 0,
    stdout: `已创建 ${filePath}\n请运行 \`zapmyco settings\` 查看配置。`,
    stderr: '',
  };
}

function maskApiKey(value: string): string {
  const envRef = value.match(/^\$\{env\.(.+)\}$/);
  if (envRef) {
    return `\${env.${envRef[1]}}`;
  }
  if (value.length <= 8) {
    return value.slice(0, 3) + '***';
  }
  return value.slice(0, 3) + '***' + value.slice(-4);
}

function handleSettingsCommand(args: string[]): CliResult {
  const subcommand = args[0];

  // settings path
  if (subcommand === 'path') {
    return { exitCode: 0, stdout: getSettingsPath(), stderr: '' };
  }

  // settings（默认：显示内容）
  if (subcommand && subcommand !== 'show') {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `未知子命令: ${subcommand}\n可用命令: settings, settings path`,
    };
  }

  const filePath = getSettingsPath();
  let settings: Record<string, unknown>;
  try {
    const content = Deno.readTextFileSync(filePath);
    settings = JSON.parse(content);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `${filePath} 不存在。请运行 \`zapmyco init\` 创建。`,
      };
    }
    if (error instanceof Error && error.name === 'NotCapable') {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `权限不足: ${filePath}\n请使用 --allow-read 权限运行。`,
      };
    }
    if (error instanceof SyntaxError) {
      return { exitCode: 1, stdout: '', stderr: `${filePath} JSON 格式错误。` };
    }
    return { exitCode: 1, stdout: '', stderr: String(error) };
  }

  // 脱敏 apiKey（支持新版和旧版结构）
  if (settings.llm && typeof settings.llm === 'object') {
    const llm = settings.llm as Record<string, unknown>;

    // 新版: llm.providers.<name>.apiKey
    if (llm.providers && typeof llm.providers === 'object') {
      const providers = llm.providers as Record<string, Record<string, unknown>>;
      for (const cfg of Object.values(providers)) {
        if (typeof cfg.apiKey === 'string') {
          cfg.apiKey = maskApiKey(cfg.apiKey);
        }
      }
    }

    // 旧版: llm.apiKey
    if (typeof llm.apiKey === 'string') {
      llm.apiKey = maskApiKey(llm.apiKey);
    }
  }

  const output = JSON.stringify(settings, null, 2);
  return { exitCode: 0, stdout: output, stderr: '' };
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
export async function cli(args: string[]): Promise<CliResult> {
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

  if (command === 'ai') {
    // 解析可选参数：ai [--profile <name>] [<content>...]
    let profile: string | undefined;
    const contentArgs: string[] = [];
    const aiArgs = [...rest];
    for (let i = 0; i < aiArgs.length; i++) {
      if (aiArgs[i] === '--profile' && i + 1 < aiArgs.length) {
        profile = aiArgs[i + 1];
        i++;
      } else {
        contentArgs.push(aiArgs[i]!);
      }
    }
    const inlineContent = contentArgs.join(' ');

    // 检查配置文件是否存在
    const settingsPath = getSettingsPath();
    try {
      Deno.statSync(settingsPath);
    } catch (_err) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `未找到配置文件 ${settingsPath}\n请先运行 \`zapmyco init\` 初始化 LLM 配置。`,
      };
    }

    try {
      const agent = new AiAgent({ modelProfile: profile });

      if (inlineContent) {
        // 内联模式：单次问答，输出结果后退出
        const response = await agent.chat(inlineContent);
        return { exitCode: 0, stdout: response, stderr: '' };
      }

      // 交互模式
      await agent.startInteractiveChat();
      return { exitCode: 0, stdout: '', stderr: '' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { exitCode: 1, stdout: '', stderr: message };
    }
  }

  if (command === 'init') {
    return await handleInitCommand();
  }

  if (command === 'settings') {
    return handleSettingsCommand(rest);
  }

  if (command === '--version' || command === '-v' || command === '-V') {
    return { exitCode: 0, stdout: `v${VERSION}`, stderr: '' };
  }

  const helpText = [
    `ZapMyCo v${VERSION}`,
    '',
    '用法:',
    '  greet <name>       向指定名称打招呼',
    '  config             显示配置信息',
    '  init               初始化 LLM 配置',
    '  ai [--profile <n>] 进入 AI 对话模式（指定模型配置档）',
    '    [<内容>]          直接传入内容进行单次问答',
    '  settings           显示 LLM 配置',
    '  settings path      显示配置文件路径',
    '  --version, -v, -V  显示版本号',
    '  --help, -h         显示帮助信息',
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
  const encoder = new TextEncoder();
  const result = await cli(Deno.args);
  if (result.stderr) {
    Deno.stderr.writeSync(encoder.encode(result.stderr + '\n'));
  }
  if (result.stdout) {
    Deno.stdout.writeSync(encoder.encode(result.stdout + '\n'));
  }
  Deno.exit(result.exitCode);
}

// 默认导出
export default {
  greet,
  createConfig,
  VERSION,
};
