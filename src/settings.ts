/**
 * Settings - ~/.zapmyco/settings.json 配置管理
 */

const SETTINGS_PATH = '.zapmyco/settings.json';

/** 供应商配置 */
export interface ProviderConfig {
  /** API 密钥，支持 ${env.VAR} 语法 */
  apiKey?: string;
}

/** LLM 配置（新格式） */
export interface LlmSettings {
  /** 供应商字典，key 为唯一标识名（如 "deepseek"、"glm"） */
  providers?: Record<string, ProviderConfig>;
  /**
   * 模型配置档字典，key 为配置档名称（如 "default"、"advanced"、"light"、"vision"），
   * value 为模型名称（对应内置模型注册表中的名称）
   */
  models?: Record<string, string>;
}

/** 旧版 LLM 配置格式 */
interface LegacyLlmSettings {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

/** 顶层配置 */
export interface Settings {
  llm?: LlmSettings;
}

/**
 * 将旧版格式转换为新版格式
 * 旧版: { llm: { apiKey, baseURL, model } }
 * 新版: { llm: { providers: { default: { apiKey } }, models: { default: model } } }
 * 只提取字符串类型的值
 */
function convertLegacySettings(legacy: LegacyLlmSettings): LlmSettings {
  return {
    providers: {
      default: {
        apiKey: typeof legacy.apiKey === 'string' ? legacy.apiKey : undefined,
      },
    },
    models: {
      default: typeof legacy.model === 'string' ? legacy.model : 'deepseek-v4-flash',
    },
  };
}

/**
 * 检测是否为旧版 LLM 配置格式
 * 要求 apiKey 或 model 为字符串类型
 */
function isLegacyFormat(llm: unknown): llm is LegacyLlmSettings {
  if (typeof llm !== 'object' || llm === null) return false;
  return typeof (llm as Record<string, unknown>).apiKey === 'string' ||
    typeof (llm as Record<string, unknown>).model === 'string';
}

/**
 * 解析 ${env.VAR} 引用
 * - "${env.DEEPSEEK_API_KEY}" → 从环境变量 DEEPSEEK_API_KEY 读取
 * - "sk-xxx" → 原样返回
 */
export function resolveEnvRef(value: string): string {
  const match = value.match(/^\$\{env\.(.+)\}$/);
  if (!match) return value;

  const envVar = match[1]!;
  const resolved = Deno.env.get(envVar);
  if (!resolved) {
    throw new Error(
      `环境变量 ${envVar} 未设置。请在 ${SETTINGS_PATH} 中配置或设置环境变量 ${envVar}。`,
    );
  }
  return resolved;
}

/**
 * 加载 ~/.zapmyco/settings.json
 * 文件不存在时返回 null，不报错
 * 自动兼容旧版格式
 */
export function loadSettings(): Settings | null {
  const home = Deno.env.get('HOME');
  if (!home) return null;

  const filePath = `${home}/${SETTINGS_PATH}`;

  try {
    const content = Deno.readTextFileSync(filePath);
    const parsed = JSON.parse(content);

    const llmRaw = parsed?.llm;
    if (!llmRaw || typeof llmRaw !== 'object') return {};

    // 兼容旧版格式
    if (isLegacyFormat(llmRaw)) {
      return { llm: convertLegacySettings(llmRaw) };
    }

    // 新版格式
    const llm = llmRaw as Record<string, unknown>;

    const providers: Record<string, ProviderConfig> = {};
    if (llm.providers && typeof llm.providers === 'object') {
      for (const [name, cfg] of Object.entries(llm.providers)) {
        if (typeof cfg === 'object' && cfg !== null) {
          const pc = cfg as Record<string, unknown>;
          providers[name] = {
            apiKey: typeof pc.apiKey === 'string' ? pc.apiKey : undefined,
          };
        }
      }
    }

    const models: Record<string, string> = {};
    if (llm.models && typeof llm.models === 'object') {
      for (const [name, modelName] of Object.entries(llm.models)) {
        if (typeof modelName === 'string') {
          models[name] = modelName;
        }
      }
    }

    return {
      llm: {
        providers: Object.keys(providers).length > 0 ? providers : undefined,
        models: Object.keys(models).length > 0 ? models : undefined,
      },
    };
  } catch (error) {
    // 文件不存在
    if (error instanceof Deno.errors.NotFound) return null;
    // Deno 权限拒绝（NotCapable）
    if (error instanceof Error && error.name === 'NotCapable') return null;
    // JSON 解析错误
    if (error instanceof SyntaxError) {
      throw new Error(
        `${filePath} JSON 格式错误: ${error.message}`,
      );
    }
    throw error;
  }
}
