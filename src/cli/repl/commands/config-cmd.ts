/**
 * /config 命令
 *
 * 查看和修改当前配置信息。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import type { CommandDefinition } from '@/cli/repl/types';
import { HOME_CONFIG_PATH } from '@/config/loader';

/** 判断 key 是否可能触发原型污染 */
function isPrototypePollutionKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

function getByDotPath(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    if (isPrototypePollutionKey(key)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

/**
 * 通过 dot-path 设置嵌套对象属性（自动创建中间对象）
 */
function setByDotPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    if (isPrototypePollutionKey(key)) {
      return;
    }
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  const lastKey = keys[keys.length - 1]!;
  if (isPrototypePollutionKey(lastKey)) {
    return;
  }
  current[lastKey] = value;
}

/**
 * 更新 settings.json 中指定 dot-path 的值
 */
function updateSettingsFile(path: string, value: string): { success: boolean; message: string } {
  try {
    const raw = readFileSync(HOME_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw);

    // 尝试解析值为 JSON（数字/布尔/对象），否则保持字符串
    let parsedValue: unknown = value;
    try {
      parsedValue = JSON.parse(value);
    } catch {
      // 保持原始字符串
    }

    setByDotPath(config, path, parsedValue);
    writeFileSync(HOME_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
    return { success: true, message: '' };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 创建 config 命令定义
 */
export function createConfigCommand(): CommandDefinition {
  return {
    name: 'config',
    aliases: [],
    description: '查看或修改配置 [show | get <key> | set <key> <value>]',
    usage: '/config [show | get <key> | set <key> <value>]',
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
        const value = getByDotPath(config as unknown as Record<string, unknown>, args[1]);
        if (value !== undefined) {
          const displayValue =
            args[1].toLowerCase().includes('apikey') || args[1].toLowerCase().includes('api_key')
              ? '***已配置***'
              : JSON.stringify(value, null, 2);
          session.appendOutput(['', `  ${args[1]}: ${displayValue}`, '']);
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

      // "set <key> <value>" → 修改配置并持久化
      if (args[0] === 'set' && args[1] && args[2] !== undefined) {
        const key = args[1];
        // 重建带引号的值（input-parser 已解析引号）
        const value = args.slice(2).join(' ');

        const result = updateSettingsFile(key, value);

        if (result.success) {
          // 同步更新内存中的 config 对象（使变更立即生效）
          let parsedValue: unknown = value;
          try {
            parsedValue = JSON.parse(value);
          } catch {
            // 保持原始字符串
          }
          setByDotPath(session.config as unknown as Record<string, unknown>, key, parsedValue);

          // 通知 session 将配置变更应用到运行中的 Agent
          session.applyConfigUpdate(key);

          // 脱敏显示
          const displayValue =
            key.toLowerCase().includes('apikey') || key.toLowerCase().includes('api_key')
              ? '***已配置***'
              : value;
          session.appendOutput([
            '',
            `  ✅ 配置已更新: ${key} = ${displayValue}`,
            `  已持久化到 ${HOME_CONFIG_PATH}`,
            '',
          ]);
        } else {
          session.appendOutput(['', `  ❌ 配置更新失败: ${result.message}`, '']);
        }
        return;
      }

      session.appendOutput([
        '',
        '  用法: /config [show | get <key> | set <key> <value>]',
        '  示例: /config set llm.providers.deepseek.apiKey sk-xxx',
        '',
      ]);
    },
  };
}
