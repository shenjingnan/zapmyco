/**
 * AI Agent - 基于 @anthropic-ai/sdk 的 LLM 对话代理
 */

import Anthropic from 'npm:@anthropic-ai/sdk@0.98';
import { TextLineStream } from './text-line-stream.ts';
import { loadSettings, resolveEnvRef } from './settings.ts';
import { getModelInfo } from './models.ts';

/** AiAgent 配置选项 */
export interface AiAgentOptions {
  /** API Key，默认从 settings.json 或 DEEPSEEK_API_KEY 环境变量读取 */
  apiKey?: string;
  /** API 基础 URL，默认从内置模型注册表读取 */
  baseURL?: string;
  /** 模型名称，默认从 modelProfile 或内置模型注册表读取 */
  model?: string;
  /**
   * 模型配置档名称（对应 settings.json llm.models 中的 key）
   * 如 "default"、"advanced"、"light"、"vision"
   */
  modelProfile?: string;
  /** 供应商名称（对应 settings.json llm.providers 中的 key） */
  provider?: string;
  /** 最大输出 tokens，默认从内置模型注册表读取 */
  maxTokens?: number;
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
  private maxTokens: number;
  private messages: Message[] = [];
  private systemPrompt: string;

  constructor(options: AiAgentOptions = {}) {
    // 加载 ~/.zapmyco/settings.json（文件不存在时静默降级）
    const settings = loadSettings();
    const llm = settings?.llm;

    // 1. 确定模型配置档名称
    const profileName = options.modelProfile ?? 'default';

    // 2. 从配置档解析模型名称
    const profileModelName = llm?.models?.[profileName];

    // 3. 最终模型名称：options.model > 配置档模型名 > 默认值
    const modelName = options.model ?? profileModelName ?? DEFAULT_MODEL;

    // 4. 从内置注册表查找模型信息
    const modelInfo = getModelInfo(modelName);

    // 5. 确定供应商名称：options.provider > 注册表中的供应商 > 'default'
    const providerName = options.provider ?? modelInfo?.provider ?? 'default';

    // 6. 解析 apiKey：options > settings.providers[provider].apiKey > 环境变量
    let apiKey: string | undefined;
    if (options.apiKey) {
      apiKey = options.apiKey;
    } else if (providerName) {
      const providerCfg = llm?.providers?.[providerName];
      if (providerCfg?.apiKey) {
        apiKey = resolveEnvRef(providerCfg.apiKey);
      }
    }
    if (!apiKey) {
      apiKey = Deno.env.get('DEEPSEEK_API_KEY');
    }
    if (!apiKey) {
      throw new Error(
        'DEEPSEEK_API_KEY 未设置。请运行 `zapmyco init` 或设置环境变量 DEEPSEEK_API_KEY。',
      );
    }

    // 7. 确定 baseURL：options > 注册表中的 baseURL > 默认值
    const baseURL = options.baseURL ?? modelInfo?.baseURL ?? DEFAULT_BASE_URL;

    // 8. 确定 maxTokens：options > 注册表中的 maxOutputTokens > 默认值 4096
    this.maxTokens = options.maxTokens ?? modelInfo?.maxOutputTokens ?? 4096;

    this.client = new Anthropic({ baseURL, apiKey });
    this.model = modelName;
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  }

  /**
   * 非流式对话（内部使用流式 API） - 发送消息并获取完整回复
   * @param input - 用户输入
   * @returns 完整回复文本
   */
  async chat(input: string): Promise<string> {
    this.messages.push({ role: 'user', content: input });

    // 内部使用流式 API 以避免非流式请求被拒绝或超时
    let fullContent = '';
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: this.maxTokens,
      system: this.systemPrompt,
      messages: this.messages,
    });

    stream.on('text', (text: string) => {
      fullContent += text;
    });

    await stream.finalMessage();
    this.messages.push({ role: 'assistant', content: fullContent });

    return fullContent;
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
      max_tokens: this.maxTokens,
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
