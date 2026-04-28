/**
 * 内置命令注册表
 *
 * 管理所有 REPL 内置命令的注册、查找和分发。
 */

import { logger } from '@/infra/logger';
import type { CommandDefinition, ParsedInput, ReplSession } from './types.js';

const log = logger.child('repl:command-registry');

/**
 * 命令注册表
 */
export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();
  private readonly aliasMap = new Map<string, string>(); // alias -> canonical name

  constructor(private readonly session: ReplSession) {}

  /**
   * 注册一个命令
   */
  register(cmd: CommandDefinition): void {
    const canonicalName = cmd.name.toLowerCase();

    // 检查是否已存在同名命令
    if (this.commands.has(canonicalName)) {
      log.warn(`命令 "${canonicalName}" 已存在，将被覆盖`);
    }

    this.commands.set(canonicalName, cmd);

    // 注册别名
    for (const alias of cmd.aliases) {
      const lowerAlias = alias.toLowerCase();
      this.aliasMap.set(lowerAlias, canonicalName);
    }
  }

  /**
   * 根据名称或别名查找命令
   */
  getCommand(name: string): CommandDefinition | undefined {
    const lowerName = name.toLowerCase();

    // 先尝试精确匹配命令名
    const direct = this.commands.get(lowerName);
    if (direct) return direct;

    // 再尝试别名查找
    const canonical = this.aliasMap.get(lowerName);
    if (canonical) {
      return this.commands.get(canonical);
    }

    return undefined;
  }

  /**
   * 列出所有已注册的命令
   */
  listCommands(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  /**
   * 分发并执行命令
   */
  async dispatch(parsed: ParsedInput): Promise<void> {
    if (parsed.kind !== 'command') {
      log.warn('dispatch 收到了非 command 类型的输入');
      return;
    }

    const cmd = this.getCommand(parsed.name);

    if (!cmd) {
      console.log(`\n  未知命令: /${parsed.name}，输入 ${'/help'} 查看可用命令\n`);
      return;
    }

    try {
      await cmd.handler(parsed.args, this.session);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`命令 /${cmd.name} 执行出错`, {}, error as Error);
      console.log(`\n  命令执行出错: ${message}\n`);
    }
  }
}

/** 类型别名（供 session 内部引用） */
export type CommandRegistryImpl = CommandRegistry;
