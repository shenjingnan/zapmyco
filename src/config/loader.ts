/**
 * zapmyco 配置加载器
 *
 * 使用 cosmiconfig 搜索并加载配置文件。
 * 支持多路径搜索，包括用户家目录 ~/.zapmyco/zapmyco.json。
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type CosmiconfigResult, cosmiconfig } from 'cosmiconfig';
import { DEFAULT_CONFIG } from '@/config/defaults';
import type { ZapmycoConfig } from '@/config/types';
import { logger } from '@/infra/logger';

// cosmiconfig 的 explorer 名称
const EXPLORER_NAME = 'zapmyco';

/** 用户家目录配置路径 */
const HOME_CONFIG_PATH = join(homedir(), '.zapmyco', 'zapmyco.json');

/**
 * 解析配置值中的环境变量引用
 *
 * 支持语法：${ENV_VAR_NAME}
 * 未定义的环境变量会被替换为空字符串
 */
function resolveEnvVars(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{(\w+)\}/g, (_match, varName) => {
      return process.env[varName] ?? '';
    });
  }

  if (Array.isArray(value)) {
    return value.map(resolveEnvVars);
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = resolveEnvVars(val);
    }
    return result;
  }

  return value;
}

/**
 * 深度合并两个对象
 */
function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key of Object.keys(source) as Array<keyof T & string>) {
    const sourceValue = source[key as keyof T];
    const targetValue = (target as Record<string, unknown>)[key];

    if (
      sourceValue !== undefined &&
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      );
    } else if (sourceValue !== undefined) {
      (result as Record<string, unknown>)[key] = sourceValue;
    }
  }

  return result;
}

/**
 * 确保家目录配置文件存在，不存在则创建模板
 */
async function ensureHomeConfig(): Promise<void> {
  if (existsSync(HOME_CONFIG_PATH)) {
    return;
  }

  const dir = join(homedir(), '.zapmyco');
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  const template: Record<string, unknown> = {
    llm: {
      defaultModel: 'anthropic/claude-sonnet-4-20250514',
      models: {
        'anthropic/claude-sonnet-4-20250514': {
          provider: 'anthropic',
          modelId: 'claude-sonnet-4-20250514',
          description: 'Anthropic Claude Sonnet 4 - 均衡模型，日常使用推荐',
        },
        'openai/gpt-4o': {
          provider: 'openai',
          modelId: 'gpt-4o',
          description: 'OpenAI GPT-4o - 多功能模型',
        },
      },
      providers: {
        anthropic: {
          // biome-ignore lint/suspicious/noTemplateCurlyInString: 环境变量引用语法
          apiKey: '${ANTHROPIC_API_KEY}',
        },
        openai: {
          // biome-ignore lint/suspicious/noTemplateCurlyInString: 环境变量引用语法
          apiKey: '${OPENAI_API_KEY}',
        },
      },
      defaults: {
        maxTokens: 8192,
        temperature: 0.7,
      },
    },
  };

  await writeFile(HOME_CONFIG_PATH, `${JSON.stringify(template, null, 2)}\n`, 'utf-8');
  logger.info('已创建默认配置文件', { filepath: HOME_CONFIG_PATH });
}

/**
 * 尝试从家目录加载配置
 */
async function tryLoadHomeConfig(): Promise<CosmiconfigResult | null> {
  try {
    if (!existsSync(HOME_CONFIG_PATH)) {
      await ensureHomeConfig();
    }

    const content = await readFile(HOME_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(content);

    return {
      config: resolveEnvVars(config),
      filepath: HOME_CONFIG_PATH,
    };
  } catch {
    return null;
  }
}

/**
 * 加载 zapmyco 配置
 *
 * 搜索优先级：
 * 1. 显式指定的 configPath
 * 2. 项目级配置文件（cosmiconfig 默认搜索）
 * 3. 用户家目录 ~/.zapmyco/zapmyco.json
 * 4. 默认值
 *
 * @param configPath - 可选的显式配置文件路径
 * @returns 合并后的完整配置（用户配置 + 默认值深度合并）
 */
export async function loadConfig(configPath?: string): Promise<ZapmycoConfig> {
  // 如果显式指定了路径，直接加载
  if (configPath) {
    const explorer = cosmiconfig(EXPLORER_NAME);
    try {
      const result = await explorer.load(configPath);
      if (!result?.config) {
        logger.debug('指定路径未找到配置，使用默认配置');
        return { ...DEFAULT_CONFIG };
      }

      logger.info('已加载配置文件', { filepath: result.filepath });
      return deepMerge(DEFAULT_CONFIG, resolveEnvVars(result.config) as Partial<ZapmycoConfig>);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('配置加载失败，使用默认配置', { error: message });
      return { ...DEFAULT_CONFIG };
    }
  }

  // 1. 先尝试 cosmiconfig 默认搜索（项目级配置）
  const explorer = cosmiconfig(EXPLORER_NAME);
  let result: CosmiconfigResult | null = null;

  try {
    result = await explorer.search();
  } catch {
    // cosmiconfig search 失败时静默处理
  }

  // 2. 如果没找到项目级配置，尝试家目录配置
  if (!result?.config) {
    const homeResult = await tryLoadHomeConfig();
    if (homeResult?.config) {
      result = homeResult;
    }
  }

  if (!result?.config) {
    logger.debug('未找到配置文件，使用默认配置');
    return { ...DEFAULT_CONFIG };
  }

  logger.info('已加载配置文件', { filepath: result.filepath });

  // 深度合并：用户配置覆盖默认值
  return deepMerge(DEFAULT_CONFIG, result.config as Partial<ZapmycoConfig>);
}

/** 导出家目录配置路径，供外部使用 */
export { HOME_CONFIG_PATH };
