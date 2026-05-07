/**
 * API Key 工具函数
 *
 * 提供 Key 遮蔽、环境变量解析等安全相关工具。
 */

/** 遮蔽 API Key，仅显示前后各 4 个字符 */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

/** 判断字符串是否包含 ${ENV_VAR} 引用语法 */
export function isEnvVarReference(value: string): boolean {
  return /\$\{(\w+)\}/.test(value);
}

/**
 * 解析字符串中的 ${ENV_VAR} 环境变量引用
 *
 * 与 config/loader.ts 的 resolveEnvVars 保持一致的语法，
 * 但在运行时解析，支持动态环境变量切换。
 */
export function resolveApiKey(value: string): string {
  if (!isEnvVarReference(value)) return value;
  return value.replace(/\$\{(\w+)\}/g, (_match, varName) => {
    return process.env[varName] ?? '';
  });
}
