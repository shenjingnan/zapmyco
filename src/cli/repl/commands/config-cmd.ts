/**
 * /config 命令
 *
 * 查看当前配置信息。
 */

import type { CommandDefinition } from '@/cli/repl/types';

/**
 * 创建 config 命令定义
 */
export function createConfigCommand(): CommandDefinition {
  return {
    name: 'config',
    aliases: ['cfg'],
    description: '查看配置 [show | get <key>]',
    usage: '/config [show | get <key>]',
    handler(args, session) {
      const config = session.config;
      const renderer = session.getRenderer();

      // 无参数或 "show" → 展示完整配置
      if (args.length === 0 || args[0] === 'show') {
        const lines = renderer.renderConfig(config);
        session.appendOutput(lines);
        return;
      }

      // "get <key>" → 获取单项配置（支持 dot-path）
      if (args[0] === 'get' && args[1]) {
        const value = getByDotPath(config, args[1]);
        if (value !== undefined) {
          const displayValue =
            args[1].toLowerCase().includes('apikey') || args[1].toLowerCase().includes('api_key')
              ? '***已配置***'
              : JSON.stringify(value, null, 2);
          session.appendOutput([``, `  ${args[1]}: ${displayValue}`, ``]);
        } else {
          session.appendOutput([
            '',
            `  未找到配置项: ${args[1]}`,
            '  使用 /config show 查看所有可用配置项',
            '',
          ]);
        }
        return;
      }

      session.appendOutput(['', '  用法: /config [show | get <key>]', '']);
    },
  };
}

/**
 * 通过 dot-path 获取嵌套对象属性
 *
 * 例如: getByPath(config, 'llm.provider') → config.llm.provider
 */
function getByDotPath(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}
