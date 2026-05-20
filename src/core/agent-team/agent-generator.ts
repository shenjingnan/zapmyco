/**
 * Agent 生成器
 *
 * 使用 LLM 根据自然语言描述自动生成 Agent 类型定义。
 * 输出格式为 YAML frontmatter + Markdown body，可直接保存为 .md 文件使用。
 *
 * @module core/agent-team
 */

import { complete as piComplete } from '@earendil-works/pi-ai';
import type { AgentTypeDefinition } from '@/core/agent-team/types';
import { logger } from '@/infra/logger';
import type { AgentLlmFacade } from '@/llm/agent-llm-facade';
import { parseAgentMarkdown } from './markdown-agent-parser';

const log = logger.child('agent-generator');

// ============ 类型定义 ============

/** 生成器配置 */
export interface AgentGeneratorConfig {
  /** 用于生成的模型（默认继承 AgentLlmFacade 的默认模型） */
  modelKey?: string;
  /** 最大输出 token */
  maxTokens?: number;
}

/** 生成结果 */
export interface AgentGeneratorResult {
  /** 成功时返回 Agent 类型定义 */
  definition?: AgentTypeDefinition | undefined;
  /** 原始 LLM 输出（markdown 文本） */
  rawOutput: string;
  /** 错误信息 */
  errors: string[];
  /** Token 使用 */
  tokenUsage?:
    | {
        inputTokens: number;
        outputTokens: number;
      }
    | undefined;
}

// ============ 常量 ============

const DEFAULT_MAX_TOKENS = 2000;

/** 生成提示词模板 */
function buildGeneratorPrompt(description: string): string {
  return [
    '你是一个 Agent 类型配置专家。根据用户的描述，生成一个 Agent 类型定义文件。',
    '',
    '输出格式必须是 YAML frontmatter + Markdown body：',
    '',
    '```',
    '---',
    'typeId: my-agent-id          # 唯一标识，小写字母+连字符',
    'displayName: 我的 Agent      # 显示名称',
    'whenToUse: 当需要...时使用   # 何时使用该类型',
    'role: worker                 # coordinator / worker / universal',
    'tools: safe                  # safe / standard / full / 或工具名数组',
    'maxSpawnDepth: 0             # 最大可再嵌套深度',
    'maxTurns: 30                 # 最大对话轮次',
    'permissionMode: restricted   # inherit / restricted / bubble / yolo',
    'skills: []                   # 注入的 Skill 列表（可选）',
    'capabilities:                # 能力声明',
    '  - id: skill-id',
    '    name: 技能名称',
    '    description: 技能描述',
    '    category: generic        # 类别',
    '---',
    '',
    '# 系统提示词',
    '',
    '这里是 Agent 的系统提示词内容。',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: 模板变量文档说明
    '可以使用 ${taskDescription}、${workdir}、${context}、${memorySnapshot} 等变量。',
    '```',
    '',
    '## 规则',
    '- typeId 必须以小写字母开头，只包含小写字母、数字和连字符',
    '- role 可选值: coordinator（协调者）、worker（工作者）、universal（通用）',
    '- tools 可选值: safe（只读安全工具）、standard（safe+写入+Shell）、full（全部工具）、或工具名数组',
    '- permissionMode 可选值: inherit（继承父级）、restricted（严格限制）、bubble（冒泡到父级）、yolo（全部允许）',
    '- category 可选值: code-generation, code-modification, code-analysis, code-review, security-scan, testing, documentation, research, planning, data-analysis, chat, generic',
    '- 系统提示词应清晰说明该 Agent 的职责、工作规则和行为约束',
    '- 只输出上述格式的内容，不要有任何额外的解释或说明',
    '',
    '## 用户描述',
    description,
  ].join('\n');
}

// ============ 公共 API ============

/**
 * 使用 LLM 根据描述生成 Agent 类型定义
 *
 * @param description - 自然语言描述
 * @param llmFacade - LLM Facade（用于获取 Model）
 * @param config - 可选配置
 * @returns 生成结果
 */
export async function generateAgentType(
  description: string,
  llmFacade: AgentLlmFacade,
  config: AgentGeneratorConfig = {}
): Promise<AgentGeneratorResult> {
  if (!description || description.trim().length === 0) {
    return {
      rawOutput: '',
      errors: ['描述不能为空'],
    };
  }

  const modelKey = config.modelKey;
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let model: ReturnType<AgentLlmFacade['resolvePiModel']>;
  try {
    model = llmFacade.resolvePiModel(modelKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      errors: [`无法解析模型: ${message}`],
      rawOutput: '',
    };
  }

  const prompt = buildGeneratorPrompt(description.trim());

  try {
    // [TODO Phase 3] 使用 AnthropicProvider.complete() 替换 piComplete
    const response = await piComplete(
      model,
      {
        systemPrompt: prompt,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: '请根据上述描述生成 Agent 类型定义。' }],
            timestamp: Date.now(),
          },
        ],
      },
      {
        maxTokens,
        temperature: 0.3, // Lower temperature for more consistent structured output
      }
    );

    // Extract text from response
    const rawOutput = extractTextFromResponse(response);
    if (!rawOutput || rawOutput.trim().length === 0) {
      const emptyResult: AgentGeneratorResult = {
        rawOutput: '',
        errors: ['LLM 返回了空的响应'],
      };
      const usage = extractTokenUsage(response);
      if (usage) {
        emptyResult.tokenUsage = usage;
      }
      return emptyResult;
    }

    // Parse the generated markdown
    const parseResult = parseAgentMarkdown('generated', rawOutput, 'user');

    if (parseResult.errors.length > 0) {
      log.warn('生成的 Agent 定义验证失败', {
        errors: parseResult.errors,
        rawOutput: rawOutput.slice(0, 200),
      });
    }

    const result: AgentGeneratorResult = {
      rawOutput,
      errors: parseResult.errors,
    };
    if (parseResult.definition) {
      result.definition = parseResult.definition;
    }
    const usage = extractTokenUsage(response);
    if (usage) {
      result.tokenUsage = usage;
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('Agent 类型生成失败', { error: message });
    return {
      rawOutput: '',
      errors: [`LLM 调用失败: ${message}`],
    };
  }
}

/**
 * 批量生成 Agent 类型定义
 *
 * @param descriptions - 多个自然语言描述
 * @param llmFacade - LLM Facade
 * @param config - 可选配置
 * @returns 生成结果列表
 */
export async function generateAgentTypes(
  descriptions: string[],
  llmFacade: AgentLlmFacade,
  config: AgentGeneratorConfig = {}
): Promise<AgentGeneratorResult[]> {
  // Sequential execution to avoid overwhelming the LLM provider
  const results: AgentGeneratorResult[] = [];
  for (const desc of descriptions) {
    const result = await generateAgentType(desc, llmFacade, config);
    results.push(result);
  }
  return results;
}

// ============ 内部实现 ============

/**
 * 从 pi-ai complete 响应中提取文本内容
 */
function extractTextFromResponse(response: unknown): string {
  if (typeof response !== 'object' || response === null) {
    return '';
  }

  const resp = response as Record<string, unknown>;

  // pi-ai 返回格式: { content: [{ type: 'text', text: '...' }] }
  if (Array.isArray(resp.content)) {
    const textParts = (resp.content as Array<Record<string, unknown>>)
      .filter((block) => block.type === 'text')
      .map((block) => String(block.text ?? ''))
      .join('');
    return textParts;
  }

  // 备用格式: { text: '...' }
  if (typeof resp.text === 'string') {
    return resp.text;
  }

  // 最后尝试: { output: '...' }
  if (typeof resp.output === 'string') {
    return resp.output;
  }

  return '';
}

/**
 * 从 pi-ai complete 响应中提取 token 用量
 */
function extractTokenUsage(response: unknown):
  | {
      inputTokens: number;
      outputTokens: number;
    }
  | undefined {
  if (typeof response !== 'object' || response === null) {
    return undefined;
  }

  const resp = response as Record<string, unknown>;
  const usage = resp.usage as Record<string, unknown> | undefined;

  if (usage && (typeof usage.inputTokens === 'number' || typeof usage.outputTokens === 'number')) {
    return {
      inputTokens: (usage.inputTokens as number) ?? 0,
      outputTokens: (usage.outputTokens as number) ?? 0,
    };
  }

  return undefined;
}
