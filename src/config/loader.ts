/**
 * zapmyco 配置加载器
 *
 * 使用 cosmiconfig 搜索并加载配置文件。
 */

import { cosmiconfig } from 'cosmiconfig';
import { logger } from '../infra/logger.js';
import { DEFAULT_CONFIG } from './defaults.js';
import type { ZapmycoConfig } from './types.js';

// cosmiconfig 的 explorer 名称
const EXPLORER_NAME = 'zapmyco';

/**
 * 加载 zapmyco 配置
 *
 * @param configPath - 可选的显式配置文件路径
 * @returns 合并后的完整配置（用户配置 + 默认值深度合并）
 */
export async function loadConfig(configPath?: string): Promise<ZapmycoConfig> {
  const explorer = cosmiconfig(EXPLORER_NAME);

  try {
    const result = configPath ? await explorer.load(configPath) : await explorer.search();

    if (!result?.config) {
      logger.debug('未找到配置文件，使用默认配置');
      return { ...DEFAULT_CONFIG };
    }

    logger.info('已加载配置文件', { filepath: result.filepath });

    // 深度合并：用户配置覆盖默认值
    return deepMerge(DEFAULT_CONFIG, result.config as Partial<ZapmycoConfig>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('配置加载失败，使用默认配置', { error: message });
    return { ...DEFAULT_CONFIG };
  }
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
