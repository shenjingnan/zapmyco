/**
 * CLI 入口 — 基于 Commander.js 的命令行界面
 */

import { Command, CommanderError } from 'npm:commander@14';
import { createConfig, greet, VERSION } from './index.ts';
import { AiAgent } from './ai-agent.ts';

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

function getSettingsPath(): string {
  return `${Deno.env.get('HOME') ?? '.'}/.zapmyco/settings.json`;
}

function getSettingsDir(): string {
  return `${Deno.env.get('HOME') ?? '.'}/.zapmyco`;
}

async function promptUser(question: string): Promise<string> {
  const encoder = new TextEncoder();
  Deno.stdout.writeSync(encoder.encode(question));
  const buf = new Uint8Array(1024);
  const n = await Deno.stdin.read(buf);
  if (n === null) return '';
  return new TextDecoder().decode(buf.subarray(0, n)).trim();
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

function displaySettings(fileContent: Record<string, unknown>): string {
  // 脱敏 apiKey（支持新版和旧版结构）
  if (fileContent.llm && typeof fileContent.llm === 'object') {
    const llm = fileContent.llm as Record<string, unknown>;

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

  return JSON.stringify(fileContent, null, 2);
}

function readSettingsFile(filePath: string): Record<string, unknown> {
  try {
    const content = Deno.readTextFileSync(filePath);
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`${filePath} 不存在。请运行 \`zapmyco init\` 创建。`);
    }
    if (error instanceof Error && error.name === 'NotCapable') {
      throw new Error(`权限不足: ${filePath}\n请使用 --allow-read 权限运行。`);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`${filePath} JSON 格式错误。`);
    }
    throw error;
  }
}

/**
 * CLI 入口 - 解析参数并执行对应操作
 * @param args - 命令行参数数组
 * @returns CLI 执行结果
 */
export async function cli(args: string[]): Promise<CliResult> {
  let capturedStdout = '';
  let capturedStderr = '';

  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: (str) => {
      capturedStdout += str;
    },
    writeErr: (str) => {
      capturedStderr += str;
    },
  });
  program.name('zapmyco');
  program.version(`v${VERSION}`, '-v, --version');
  program.description('基于 Deno 的 AI 驱动命令行工具');
  program.helpOption('-h, --help', '显示帮助信息');

  // --- greet ---
  program.command('greet')
    .description('向指定名称打招呼')
    .argument('<name>', '要打招呼的名称')
    .action((name: string) => {
      try {
        capturedStdout += greet(name);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        capturedStderr += msg;
        throw new CommanderError(1, 'commander.greetError', msg);
      }
    });

  // --- config ---
  program.command('config')
    .description('显示配置信息')
    .action(() => {
      const config = createConfig();
      capturedStdout += JSON.stringify(config, null, 2);
    });

  // --- init ---
  program.command('init')
    .description('初始化 LLM 配置')
    .action(async () => {
      const result = await handleInitCommand();
      capturedStdout += result.stdout;
      capturedStderr += result.stderr;
      if (result.exitCode !== 0) {
        throw new CommanderError(result.exitCode, 'commander.initError', capturedStderr);
      }
    });

  // --- settings ---
  program.command('settings')
    .description('显示 LLM 配置')
    .argument('[subcommand]', '子命令: path')
    .action((subcommand: string | undefined) => {
      if (subcommand === 'path') {
        capturedStdout += getSettingsPath();
        return;
      }
      if (subcommand && subcommand !== 'show') {
        capturedStderr += `未知子命令: ${subcommand}\n可用命令: settings, settings path`;
        throw new CommanderError(1, 'commander.settingsError', capturedStderr);
      }

      // settings / settings show
      const filePath = getSettingsPath();
      try {
        const fileContent = readSettingsFile(filePath);
        capturedStdout += displaySettings(fileContent);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        capturedStderr += msg;
        throw new CommanderError(1, 'commander.settingsError', msg);
      }
    });

  // --- ai ---
  program.command('ai')
    .description('AI 对话模式')
    .option('--profile <name>', '指定模型配置档')
    .argument('[content...]', '直接传入内容进行单次问答')
    .action(async (contentArgs: string[] | undefined, options: { profile?: string }) => {
      // 检查配置文件是否存在
      const settingsPath = getSettingsPath();
      try {
        Deno.statSync(settingsPath);
      } catch {
        capturedStderr +=
          `未找到配置文件 ${settingsPath}\n请先运行 \`zapmyco init\` 初始化 LLM 配置。`;
        throw new CommanderError(1, 'commander.aiError', capturedStderr);
      }

      try {
        const agent = new AiAgent({ modelProfile: options.profile });
        const inlineContent = contentArgs?.join(' ') ?? '';

        if (inlineContent) {
          const response = await agent.chat(inlineContent);
          capturedStdout += response;
          return;
        }

        await agent.startInteractiveChat();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        capturedStderr += message;
        throw new CommanderError(1, 'commander.aiError', capturedStderr);
      }
    });

  // --- 执行 ---
  try {
    if (args.length === 0) {
      program.outputHelp();
      return { exitCode: 0, stdout: capturedStdout, stderr: capturedStderr };
    }

    await program.parseAsync(args, { from: 'user' });
    return { exitCode: 0, stdout: capturedStdout, stderr: capturedStderr };
  } catch (err) {
    if (err instanceof CommanderError) {
      // exitCode === 0 时（如 --help、--version），忽略 commander 内部消息
      if (err.exitCode === 0) {
        return { exitCode: 0, stdout: capturedStdout, stderr: '' };
      }
      return {
        exitCode: err.exitCode,
        stdout: capturedStdout,
        stderr: capturedStderr || err.message,
      };
    }
    throw err;
  }
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
