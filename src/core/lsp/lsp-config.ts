/**
 * LSP 服务器配置加载
 *
 * 定义内置语言服务器并提供配置合并逻辑。
 * 用户配置可覆盖/追加内置 server。
 *
 * @module core/lsp
 */

import type { LspConfig, LspServerConfig } from './types';

// ============ 内置语言服务器 ============

/** 内置 TypeScript/JavaScript LSP 服务器配置 */
export const BUILTIN_LSP_SERVERS: LspServerConfig[] = [
  {
    name: 'typescript',
    command: 'typescript-language-server',
    args: ['--stdio'],
    languageIds: ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'],
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'],
    connectTimeoutMs: 30000,
    requestTimeoutMs: 15000,
  },
];

// ============ 配置解析 ============

/**
 * 解析并合并 LSP 配置
 *
 * 规则：
 * 1. 加载内置 server 配置
 * 2. 用户 servers 中同名项覆盖内置，不同名追加
 * 3. enabled=false 的 server 移除
 * 4. userConfig.enabled=false 全局禁用，返回空数组
 *
 * @param userConfig - 用户配置（可选）
 * @returns 生效的 server 配置列表
 */
export function resolveLspConfig(userConfig?: LspConfig): LspServerConfig[] {
  if (userConfig?.enabled === false) {
    return [];
  }

  const serverMap = new Map<string, LspServerConfig>();

  // 1. 加载内置 server（始终加载，用户可通过 enabled=false 禁用具体 server）
  for (const builtin of BUILTIN_LSP_SERVERS) {
    serverMap.set(builtin.name, { ...builtin });
  }

  // 2. 用户服务器覆盖/追加
  if (userConfig?.servers) {
    for (const userServer of userConfig.servers) {
      if (userServer.enabled === false) {
        // 禁用同名内置 server
        serverMap.delete(userServer.name);
        continue;
      }

      const existing = serverMap.get(userServer.name);
      if (existing) {
        // 覆盖
        serverMap.set(userServer.name, { ...existing, ...userServer });
      } else {
        // 追加
        serverMap.set(userServer.name, { ...userServer });
      }
    }
  }

  // 3. 过滤禁用的
  return Array.from(serverMap.values()).filter((s) => s.enabled !== false);
}

/**
 * 检测指定的命令在 PATH 中是否可用
 */
export async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    const { execFile } = await import('node:child_process');
    return new Promise<boolean>((resolve) => {
      execFile('which', [command], { timeout: 5000 }, (err) => {
        resolve(err === null);
      });
    });
  } catch {
    return false;
  }
}

/**
 * 过滤掉命令不可用的 server 并返回报告
 */
export async function filterAvailableServers(servers: LspServerConfig[]): Promise<{
  available: LspServerConfig[];
  unavailable: string[];
}> {
  const available: LspServerConfig[] = [];
  const unavailable: string[] = [];

  for (const server of servers) {
    // 对内置 server 检查命令可用性
    const isBuiltin = BUILTIN_LSP_SERVERS.some((b) => b.name === server.name);
    if (isBuiltin) {
      const available_ = await isCommandAvailable(server.command);
      if (available_) {
        available.push(server);
      } else {
        unavailable.push(`${server.name} (${server.command} not found in PATH)`);
      }
    } else {
      // 用户自定义 server 直接加入
      available.push(server);
    }
  }

  return { available, unavailable };
}
