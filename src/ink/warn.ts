/**
 * warn — 开发时校验
 *
 * 提供开发时的整数值校验等辅助函数。
 * 参考 claude-code src/ink/warn.ts
 */

/**
 * 如果 value 不是整数，打印警告。
 * @param value - 要检查的值（undefined 时跳过）
 * @param name  - 变量名称（用于警告信息）
 */
export function ifNotInteger(value: number | undefined, name: string): void {
  if (value === undefined) return;
  if (Number.isInteger(value)) return;
  console.warn(`${name} should be an integer, got ${value}`);
}
