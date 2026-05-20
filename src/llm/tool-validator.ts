/**
 * 工具参数校验器
 *
 * 将 JSON Schema 格式的 tool parameters 转为 Zod schema 执行校验。
 * 替代 pi-ai 的 validateToolArguments()。
 *
 * @module llm/tool-validator
 */

import { z } from 'zod';

// ============ 错误定义 ============

export class ToolValidationError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly zodIssues: z.ZodIssue[],
    public readonly rawArgs: unknown
  ) {
    super(formatValidationError(toolName, zodIssues, rawArgs));
    this.name = 'ToolValidationError';
  }
}

// ============ JSON Schema → Zod ============

/**
 * 将 JSON Schema property descriptor 转换为 Zod type
 */
function propToZod(prop: Record<string, unknown>): z.ZodTypeAny {
  // enum 优先
  if (Array.isArray(prop.enum) && prop.enum.length > 0) {
    const enumValues = prop.enum.filter(
      (v): v is string | number => typeof v === 'string' || typeof v === 'number'
    );
    if (enumValues.length > 0) {
      // Zod v4 支持单值 enum
      return z.enum(enumValues as [string, ...string[]]);
    }
  }

  switch (prop.type) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'integer':
      return z.number().int();
    case 'boolean':
      return z.boolean();
    case 'array': {
      const items = (prop.items as Record<string, unknown>) ?? {};
      return z.array(propToZod(items));
    }
    case 'object': {
      return objSchemaToZod(prop);
    }
    default:
      return z.any();
  }
}

/**
 * 将 JSON Schema object 转为 Zod object
 */
function objSchemaToZod(schema: Record<string, unknown>): z.ZodObject<z.ZodRawShape> {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = (schema.required ?? []) as string[];
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(properties)) {
    let zodType = propToZod(prop);

    if (!required.includes(key)) {
      zodType = zodType.optional();
    }

    if (prop.default !== undefined) {
      zodType = zodType.default(prop.default);
    }

    shape[key] = zodType;
  }

  return z.object(shape);
}

// ============ 校验入口 ============

/**
 * 校验工具调用参数
 *
 * @param toolName - 工具名称（用于错误消息）
 * @param parameters - JSON Schema 格式的参数定义
 * @param args - LLM 返回的原始参数
 * @returns 校验并强制转换后的参数
 * @throws ToolValidationError 校验失败时
 */
export function validateToolCallArguments(
  toolName: string,
  parameters: Record<string, unknown>,
  args: Record<string, unknown>
): Record<string, unknown> {
  const zodSchema = objSchemaToZod(parameters);
  const result = zodSchema.safeParse(args ?? {});

  if (!result.success) {
    throw new ToolValidationError(toolName, result.error.issues, args);
  }

  return result.data as Record<string, unknown>;
}

// ============ 错误格式化 ============

function formatValidationError(toolName: string, issues: z.ZodIssue[], rawArgs: unknown): string {
  const errors = issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `  - ${path}: ${issue.message}`;
    })
    .join('\n');

  return [
    `Validation failed for tool "${toolName}":`,
    errors,
    '',
    'Received arguments:',
    JSON.stringify(rawArgs, null, 2),
  ].join('\n');
}
