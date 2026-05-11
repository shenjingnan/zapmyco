/**
 * Markdown Agent 解析器
 *
 * 解析 YAML frontmatter + Markdown body 格式的 Agent 定义文件，
 * 输出 AgentTypeDefinition，供 AgentTypeRegistry 注册。
 *
 * 文件格式示例：
 * ```markdown
 * ---
 * typeId: my-expert
 * displayName: 我的专家
 * whenToUse: 当需要处理特定领域的问题时
 * role: worker
 * tools: safe
 * maxSpawnDepth: 0
 * maxTurns: 30
 * model: claude-sonnet-4-6
 * color: "#ff6600"
 * skills:
 *   - domain-skill
 * permissionMode: restricted
 * capabilities:
 *   - id: domain-expertise
 *     name: 领域专业知识
 *     description: 具备特定领域的深度知识
 *     category: research
 * ---
 *
 * # 系统提示词
 *
 * 这里的内容会作为 Agent 的系统提示词模板。
 * ```
 *
 * @module core/agent-team
 */

import matter from 'gray-matter';
import type {
  AgentSystemPromptContext,
  AgentToolPolicy,
  AgentTypeDefinition,
} from '@/core/agent-team/types';
import { logger } from '@/infra/logger';
import type { Capability, CapabilityCategory } from '@/protocol/capability';

const log = logger.child('markdown-agent-parser');

// ============ Frontmatter 类型 ============

/** 简化的 Capability 声明（用户可省略 name 和 description） */
interface CapabilityInput {
  id: string;
  name?: string;
  description?: string;
  category: string;
}

/** 解析结果中的 frontmatter 数据 */
interface AgentFrontmatter {
  typeId?: unknown;
  displayName?: unknown;
  whenToUse?: unknown;
  role?: unknown;
  tools?: unknown;
  maxSpawnDepth?: unknown;
  maxTurns?: unknown;
  model?: unknown;
  color?: unknown;
  skills?: unknown;
  permissionMode?: unknown;
  capabilities?: unknown;
  hidden?: unknown;
  disabled?: unknown;
}

// ============ 验证规则 ============

const REQUIRED_FIELDS = ['typeId', 'displayName', 'whenToUse'] as const;
const VALID_ROLES = ['coordinator', 'worker', 'universal'] as const;
const VALID_TOOL_MODES = ['safe', 'standard', 'full', 'inherit'] as const;
const VALID_PERMISSION_MODES = ['inherit', 'restricted', 'bubble', 'yolo'] as const;

// ============ 解析结果 ============

/** 解析结果 */
export interface ParseResult {
  /** 成功时返回 AgentTypeDefinition */
  definition?: AgentTypeDefinition;
  /** 失败时返回错误列表 */
  errors: string[];
  /** 解析来源文件路径 */
  filePath: string;
}

// ============ 公共 API ============

/**
 * 解析单个 Markdown Agent 定义文件
 *
 * @param filePath - 文件路径
 * @param content - 文件内容
 * @param source - 来源类型（project 或 user）
 * @returns ParseResult
 */
export function parseAgentMarkdown(
  filePath: string,
  content: string,
  source: 'project' | 'user'
): ParseResult {
  const errors: string[] = [];

  // 1. 解析 frontmatter
  let frontmatter: AgentFrontmatter;
  let body: string;
  try {
    const parsed = matter(content);
    frontmatter = parsed.data as AgentFrontmatter;
    body = parsed.content;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      errors: [`无法解析 frontmatter: ${message}`],
      filePath,
    };
  }

  // 2. 验证必填字段
  const frontmatterObj = frontmatter as Record<string, unknown>;
  for (const field of REQUIRED_FIELDS) {
    if (frontmatterObj[field] == null || frontmatterObj[field] === '') {
      errors.push(`缺少必填字段: ${field}`);
    }
  }

  const typeId = typeof frontmatter.typeId === 'string' ? frontmatter.typeId.trim() : '';
  const displayName =
    typeof frontmatter.displayName === 'string' ? frontmatter.displayName.trim() : '';
  const whenToUse = typeof frontmatter.whenToUse === 'string' ? frontmatter.whenToUse.trim() : '';

  if (typeId && !/^[a-z][a-z0-9-]+$/.test(typeId)) {
    errors.push(`typeId 格式无效: "${typeId}"，必须以小写字母开头，只含小写字母、数字和连字符`);
  }

  // 3. 验证 role
  const role = (typeof frontmatter.role === 'string' ? frontmatter.role : 'worker') as string;
  if (!VALID_ROLES.includes(role as (typeof VALID_ROLES)[number])) {
    errors.push(`无效的 role: "${role}"，可选值: ${VALID_ROLES.join(', ')}`);
  }

  // 4. 解析工具策略
  const toolPolicy = parseToolPolicy(frontmatter.tools, errors);

  // 5. 验证 permissionMode
  const permissionMode = (
    typeof frontmatter.permissionMode === 'string' ? frontmatter.permissionMode : 'restricted'
  ) as string;
  if (!VALID_PERMISSION_MODES.includes(permissionMode as (typeof VALID_PERMISSION_MODES)[number])) {
    errors.push(
      `无效的 permissionMode: "${permissionMode}"，可选值: ${VALID_PERMISSION_MODES.join(', ')}`
    );
  }

  // 6. 解析数值字段
  const maxSpawnDepth = parseOptionalInt(frontmatter.maxSpawnDepth, 'maxSpawnDepth', 0, errors);
  const maxTurns = parseOptionalInt(frontmatter.maxTurns, 'maxTurns', 30, errors);

  // 7. 解析 capabilities
  const capabilities = parseCapabilities(frontmatter.capabilities, displayName, errors);

  // 8. 解析 skills
  const skills = parseStringArray(frontmatter.skills, 'skills', errors);

  // 9. 解析 model
  const model = typeof frontmatter.model === 'string' ? frontmatter.model.trim() : undefined;

  // 10. 解析 color
  const color = typeof frontmatter.color === 'string' ? frontmatter.color.trim() : undefined;

  // 11. 解析 hidden
  const hidden = typeof frontmatter.hidden === 'boolean' ? frontmatter.hidden : false;

  // 12. 解析 disabled
  const disabled = typeof frontmatter.disabled === 'boolean' ? frontmatter.disabled : false;

  // 如果有错误，提前返回
  if (errors.length > 0) {
    return { errors, filePath };
  }

  // 如果标记为 disabled，跳过
  if (disabled) {
    log.info('Agent 类型已禁用，跳过', { typeId, filePath });
    return { errors: [], filePath };
  }

  // 13. 构建 AgentTypeDefinition
  const baseDir = filePath.replace(/\/[^/]+\.md$/, '');

  const definition: AgentTypeDefinition = {
    typeId,
    displayName,
    whenToUse,
    role: role as AgentTypeDefinition['role'],
    capabilities,
    toolPolicy,
    permissionMode: permissionMode as AgentTypeDefinition['permissionMode'],
    source,
    baseDir,
    maxTurns,
    maxSpawnDepth,
    getSystemPrompt: createSystemPromptFn(body, displayName),
    ...(model !== undefined ? { model } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(hidden ? { hidden } : {}),
    ...(skills.length > 0 ? { skills } : {}),
  };

  return { definition, errors: [], filePath };
}

/**
 * 批量解析 Markdown Agent 文件
 *
 * @param files - { filePath, content } 列表
 * @param source - 来源类型
 * @returns 成功解析的 AgentTypeDefinition 列表和全部错误
 */
export function parseAgentMarkdownBatch(
  files: Array<{ filePath: string; content: string }>,
  source: 'project' | 'user'
): {
  definitions: AgentTypeDefinition[];
  errors: Array<{ filePath: string; messages: string[] }>;
} {
  const definitions: AgentTypeDefinition[] = [];
  const errors: Array<{ filePath: string; messages: string[] }> = [];

  for (const file of files) {
    const result = parseAgentMarkdown(file.filePath, file.content, source);
    if (result.errors.length > 0) {
      errors.push({ filePath: file.filePath, messages: result.errors });
      log.warn('Agent Markdown 解析失败', { filePath: file.filePath, errors: result.errors });
    }
    if (result.definition) {
      definitions.push(result.definition);
    }
  }

  log.info('批量解析完成', {
    total: files.length,
    succeeded: definitions.length,
    failed: errors.length,
  });

  return { definitions, errors };
}

// ============ 内部辅助函数 ============

/**
 * 解析工具策略
 */
function parseToolPolicy(tools: unknown, errors: string[]): AgentToolPolicy {
  if (tools == null) {
    return { mode: 'safe' };
  }

  if (typeof tools === 'string') {
    const mode = tools as string;
    if (VALID_TOOL_MODES.includes(mode as (typeof VALID_TOOL_MODES)[number])) {
      if (mode === 'custom') {
        errors.push('tools 为 "custom" 模式时必须提供工具名称数组');
        return { mode: 'safe' };
      }
      return { mode: mode as Exclude<AgentToolPolicy['mode'], 'custom'> };
    }
    errors.push(
      `无效的 tools 模式: "${mode}"，可选值: ${VALID_TOOL_MODES.join(', ')} 或工具名称数组`
    );
    return { mode: 'safe' };
  }

  if (Array.isArray(tools)) {
    const toolList = tools.filter((t): t is string => typeof t === 'string');
    if (toolList.length !== tools.length) {
      errors.push('tools 数组中包含非字符串元素');
    }
    return { mode: 'custom', tools: toolList };
  }

  errors.push('tools 字段必须是字符串模式或工具名称数组');
  return { mode: 'safe' };
}

/**
 * 解析 capabilities
 */
function parseCapabilities(input: unknown, displayName: string, errors: string[]): Capability[] {
  if (input == null) {
    // 默认生成一个通用 capability
    return [
      {
        id: 'general',
        name: displayName,
        description: `由 ${displayName} 提供的能力`,
        category: 'generic',
      },
    ];
  }

  if (!Array.isArray(input)) {
    errors.push('capabilities 必须是数组');
    return [];
  }

  const VALID_CATEGORIES: CapabilityCategory[] = [
    'code-generation',
    'code-modification',
    'code-analysis',
    'code-review',
    'security-scan',
    'testing',
    'documentation',
    'research',
    'planning',
    'data-analysis',
    'chat',
    'generic',
  ];

  return input
    .map((item: unknown, index: number) => {
      if (typeof item !== 'object' || item === null) {
        errors.push(`capabilities[${index}] 必须是对象`);
        return null;
      }

      const cap = item as CapabilityInput;
      const id = typeof cap.id === 'string' ? cap.id.trim() : '';
      if (!id) {
        errors.push(`capabilities[${index}] 缺少 id 字段`);
        return null;
      }

      const category = (typeof cap.category === 'string' ? cap.category : 'generic') as string;
      if (!VALID_CATEGORIES.includes(category as CapabilityCategory)) {
        errors.push(
          `capabilities[${index}].category "${category}" 无效，可选值: ${VALID_CATEGORIES.join(', ')}`
        );
      }

      return {
        id,
        name: typeof cap.name === 'string' ? cap.name : id,
        description:
          typeof cap.description === 'string' ? cap.description : `${displayName} 的 ${id} 能力`,
        category: (VALID_CATEGORIES.includes(category as CapabilityCategory)
          ? category
          : 'generic') as CapabilityCategory,
      };
    })
    .filter((c): c is Capability => c !== null);
}

/**
 * 解析可选的整数字段
 */
function parseOptionalInt(
  value: unknown,
  fieldName: string,
  defaultValue: number,
  errors: string[]
): number {
  if (value == null) return defaultValue;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) return parsed;
  }
  errors.push(`${fieldName} 必须是非负整数，使用默认值 ${defaultValue}`);
  return defaultValue;
}

/**
 * 解析字符串数组
 */
function parseStringArray(value: unknown, fieldName: string, errors: string[]): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    errors.push(`${fieldName} 必须是数组`);
    return [];
  }
  return value
    .filter((item): item is string => {
      if (typeof item !== 'string') {
        errors.push(`${fieldName} 数组包含非字符串元素: ${String(item)}`);
        return false;
      }
      return true;
    })
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 从 Markdown body 创建 getSystemPrompt 函数
 *
 * body 内容作为系统提示词模板，支持变量插值：
 * - ${taskDescription} — 任务描述
 * - ${workdir} — 工作目录
 * - ${context} — 背景上下文
 * - ${memorySnapshot} — 记忆快照
 */
function createSystemPromptFn(
  body: string,
  _displayName: string
): (ctx: AgentSystemPromptContext) => string {
  const template = body.trim() || '你是一个 AI Agent，负责执行分配给你的任务。';

  return (ctx: AgentSystemPromptContext): string => {
    let prompt = template;

    // 变量插值
    const vars: Record<string, string> = {
      taskDescription: ctx.taskDescription || '',
      workdir: ctx.workdir || process.cwd(),
      context: ctx.context || '',
      memorySnapshot: ctx.memorySnapshot || '',
    };

    for (const [key, value] of Object.entries(vars)) {
      prompt = prompt.replaceAll(`\${${key}}`, value);
    }

    // 如果有 skill 内容，追加到末尾
    if (ctx.skillContents && ctx.skillContents.length > 0) {
      prompt += '\n\n---\n\n## 注入的 Skill 知识\n\n';
      prompt += ctx.skillContents.join('\n\n---\n\n');
    }

    // 如果有上游结果，追加
    if (ctx.upstreamResults && ctx.upstreamResults.length > 0) {
      prompt += '\n\n---\n\n## 上游结果\n\n';
      prompt += ctx.upstreamResults.map((r, i) => `${i + 1}. ${r}`).join('\n');
    }

    return prompt;
  };
}
