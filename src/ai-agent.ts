/**
 * AI Agent - 基于 @anthropic-ai/sdk 的 LLM 对话代理
 */

import Anthropic from 'npm:@anthropic-ai/sdk@0.39';
import { TextLineStream } from './text-line-stream.ts';
import { loadSettings, resolveEnvRef } from './settings.ts';

/** AiAgent 配置选项 */
export interface AiAgentOptions {
  /** API Key，默认从 DEEPSEEK_API_KEY 环境变量读取 */
  apiKey?: string;
  /** API 基础 URL，默认 https://api.deepseek.com/anthropic */
  baseURL?: string;
  /** 模型名称，默认 deepseek-v4-flash */
  model?: string;
  /** 系统提示词 */
  systemPrompt?: string;
}

/** 对话消息 */
export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const DEFAULT_SYSTEM_PROMPT = '你是一个 AI 编程助手，帮助用户解决编程问题。';

/**
 * AI Agent 类 - 封装 LLM 对话功能
 */
export class AiAgent {
  private client: Anthropic;
  private model: string;
  private messages: Message[] = [];
  private systemPrompt: string;

  constructor(options: AiAgentOptions = {}) {
    // 加载 ~/.zapmyco/settings.json（文件不存在时静默降级）
    const settings = loadSettings();
    const llm = settings?.llm;

    // 解析 apiKey：options > settings.json(${VAR}解析) > 环境变量
    const settingsApiKey = llm?.apiKey ? resolveEnvRef(llm.apiKey) : undefined;
    const envApiKey = Deno.env.get('DEEPSEEK_API_KEY');
    const apiKey = options.apiKey ?? settingsApiKey ?? envApiKey;
    if (!apiKey) {
      throw new Error(
        'DEEPSEEK_API_KEY 未设置。请运行 \`zapmyco init\` 或设置环境变量 DEEPSEEK_API_KEY。',
      );
    }

    this.client = new Anthropic({
      baseURL: options.baseURL ?? llm?.baseURL ?? DEFAULT_BASE_URL,
      apiKey,
    });
    this.model = options.model ?? llm?.model ?? DEFAULT_MODEL;
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  }

  /**
   * 非流式对话 - 发送消息并获取完整回复
   * @param input - 用户输入
   * @returns 完整回复文本
   */
  async chat(input: string): Promise<string> {
    this.messages.push({ role: 'user', content: input });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: this.systemPrompt,
      messages: this.messages,
    });

    const firstBlock = response.content[0];
    const content = firstBlock?.type === 'text' ? firstBlock.text : '';
    this.messages.push({ role: 'assistant', content });

    return content;
  }

  /**
   * 流式对话 - 发送消息并通过回调逐块获取回复
   * @param input - 用户输入
   * @param onChunk - 每收到一个文本块的回调
   * @returns 完整回复文本
   */
  async chatStream(
    input: string,
    onChunk: (text: string) => void,
  ): Promise<string> {
    this.messages.push({ role: 'user', content: input });

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 4096,
      system: this.systemPrompt,
      messages: this.messages,
    });

    stream.on('text', (text: string) => {
      onChunk(text);
    });

    const response = await stream.finalMessage();
    const firstBlock = response.content[0];
    const content = firstBlock?.type === 'text' ? firstBlock.text : '';
    this.messages.push({ role: 'assistant', content });

    return content;
  }

  /**
   * 启动交互式对话 - 从 stdin 读取输入，流式输出到 stdout
   */
  async startInteractiveChat(): Promise<void> {
    const encoder = new TextEncoder();

    console.error('进入 AI 对话模式');
    console.error(`模型: ${this.model}`);
    console.error('输入 /exit 退出，/clear 清空上下文');
    console.error('---');

    const lines = Deno.stdin.readable
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TextLineStream());

    for await (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed === '/exit') {
        console.error('\n再见！');
        break;
      }

      if (trimmed === '/clear') {
        this.messages = [];
        console.error('上下文已清空');
        continue;
      }

      // 在 stderr 显示用户输入（不影响 stdout 的纯 AI 输出）
      console.error(`\n❯ ${trimmed}\n`);

      try {
        await this.chatStream(trimmed, (chunk) => {
          Deno.stdout.writeSync(encoder.encode(chunk));
        });
        console.error('\n---');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`\n[错误] ${message}`);
      }
    }
  }

  /** 清空对话上下文 */
  clearContext(): void {
    this.messages = [];
  }

  /** 获取当前对话历史 */
  getMessages(): readonly Message[] {
    return this.messages;
  }
}
