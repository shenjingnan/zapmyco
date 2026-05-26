/**
 * Settings - ~/.zapmyco/settings.json 配置管理
 */

const SETTINGS_PATH = '.zapmyco/settings.json';

/** LLM 配置 */
export interface LlmSettings {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

/** 顶层配置 */
export interface Settings {
  llm?: LlmSettings;
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
 */
export function loadSettings(): Settings | null {
  const home = Deno.env.get('HOME');
  if (!home) return null;

  const filePath = `${home}/${SETTINGS_PATH}`;

  try {
    const content = Deno.readTextFileSync(filePath);
    const parsed = JSON.parse(content);

    // 只提取 llm 对象中的已知字段
    const llm = parsed?.llm;
    if (!llm || typeof llm !== 'object') return {};

    return {
      llm: {
        apiKey: typeof llm.apiKey === 'string' ? llm.apiKey : undefined,
        baseURL: typeof llm.baseURL === 'string' ? llm.baseURL : undefined,
        model: typeof llm.model === 'string' ? llm.model : undefined,
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
