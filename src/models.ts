/**
 * Models - 内置模型注册表
 *
 * 集中维护所有内置模型的元信息（供应商归属、baseURL、能力）。
 * settings.json 中只需引用模型名称，详细信息由此处提供。
 */

/** 模型能力 */
export type ModelCapability = 'text' | 'vision';

/** 内置模型信息 */
export interface BuiltInModel {
  /** 所属供应商标识（对应 settings.json 中 llm.providers 的 key） */
  provider: string;
  /** API 基础地址 */
  baseURL: string;
  /** 模型能力列表 */
  capabilities: ModelCapability[];
}

/** 内置模型注册表 */
const BUILT_IN_MODELS: Record<string, BuiltInModel> = {
  'deepseek-v4-flash': {
    provider: 'deepseek',
    baseURL: 'https://api.deepseek.com/anthropic',
    capabilities: ['text'],
  },
  'deepseek-v4-pro': {
    provider: 'deepseek',
    baseURL: 'https://api.deepseek.com/anthropic',
    capabilities: ['text'],
  },
  'deepseek-reasoner': {
    provider: 'deepseek',
    baseURL: 'https://api.deepseek.com/anthropic',
    capabilities: ['text'],
  },
  'glm-4-flash': {
    provider: 'glm',
    baseURL: 'https://open.bigmodel.cn/api/anthropic',
    capabilities: ['text'],
  },
  'glm-4v': {
    provider: 'glm',
    baseURL: 'https://open.bigmodel.cn/api/anthropic',
    capabilities: ['text', 'vision'],
  },
  'glm-5v-turbo': {
    provider: 'glm',
    baseURL: 'https://open.bigmodel.cn/api/anthropic',
    capabilities: ['text', 'vision'],
  },
};

/**
 * 根据模型名称获取内置模型信息
 * @param name - 模型名称
 * @returns 模型信息，未找到时返回 undefined
 */
export function getModelInfo(name: string): BuiltInModel | undefined {
  return BUILT_IN_MODELS[name];
}

/**
 * 获取所有内置模型名称列表
 */
export function getBuiltInModelNames(): string[] {
  return Object.keys(BUILT_IN_MODELS);
}
