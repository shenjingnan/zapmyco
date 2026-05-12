/**
 * LSP 服务器管理器 — Layer 3
 *
 * 管理多个 LSP 服务器实例：
 * - 根据文件扩展名路由请求
 * - 协调文档同步（didOpen/didChange/didClose）
 * - 追踪 broken server
 * - 懒启动（首次请求时才启动 server）
 *
 * @module core/lsp
 */

import { createLspServerInstance, type LspServerInstance } from './lsp-server-instance';
import { LspError, type LspManagerStatus, type LspServerConfig } from './types';

// ============ 类型 ============

export interface LspServerManager {
  /** 初始化（加载配置，不立即启动 server） */
  init(servers: LspServerConfig[], workspaceRoot: string): Promise<void>;

  /** 文件被打开时触发（触发 didOpen 文档同步） */
  onFileOpened(filePath: string, content: string): Promise<void>;

  /** 文件被修改时触发 */
  onFileChanged(filePath: string, content: string): Promise<void>;

  /** 文件被关闭时触发 */
  onFileClosed(filePath: string): Promise<void>;

  /**
   * 对指定文件执行 LSP 请求
   * 自动路由到正确的 server，确保文档已打开
   */
  request<T>(filePath: string, method: string, params?: unknown): Promise<T>;

  /** 获取文件对应的 server 实例 */
  getServerForFile(filePath: string): LspServerInstance | undefined;

  /** 获取管理器状态 */
  getStatus(): LspManagerStatus;

  /** 关闭所有 server */
  shutdown(): Promise<void>;
}

// ============ 实现 ============

export function createLspServerManager(): LspServerManager {
  /** 扩展名 → server 实例 */
  const extensionMap = new Map<string, LspServerInstance>();

  /** 所有 server 实例 */
  const servers: LspServerInstance[] = [];

  /** 已打开文档追踪：uri → { serverId, languageId, version } */
  const openedFiles = new Map<string, { serverId: string; languageId: string; version: number }>();

  /** 永久失败的 server ID 集合 */
  const brokenServers = new Set<string>();

  /** 初始化状态 */
  let initialized = false;

  /** 工作区根路径 */
  let workspaceRoot = '';

  // ---- 扩展名路由 ----

  function findLanguageId(extension: string, server: LspServerInstance): string | undefined {
    const languageIds = server.getLanguageIds();
    if (languageIds.length === 0) return undefined;

    // 简单映射：.ts → typescript, .tsx → typescriptreact, .js → javascript
    const extToLang: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.jsx': 'javascriptreact',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.mts': 'typescript',
      '.cts': 'typescript',
    };

    return extToLang[extension] ?? languageIds[0];
  }

  function getServerForFile(filePath: string): LspServerInstance | undefined {
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    const server = extensionMap.get(ext);
    if (server && !brokenServers.has(server.getServerId())) {
      return server;
    }
    return undefined;
  }

  function getLanguageForFile(filePath: string, server: LspServerInstance): string {
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    return findLanguageId(ext, server) ?? 'plaintext';
  }

  // ---- 文件同步 ----

  async function ensureFileOpened(
    filePath: string,
    server: LspServerInstance,
    content?: string
  ): Promise<void> {
    const uri = `file://${filePath}`;

    if (openedFiles.has(uri)) {
      return;
    }

    const languageId = getLanguageForFile(filePath, server);

    try {
      await server.ensureDocumentOpened(uri, languageId, content ?? '');
      openedFiles.set(uri, {
        serverId: server.getServerId(),
        languageId,
        version: 1,
      });
    } catch (err) {
      // didOpen 失败不阻塞后续操作
      if (process.env.ZAPMYCO_LSP_TRACE) {
        process.stderr.write(
          `[lsp-manager] ensureFileOpened failed: ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
    }
  }

  // ---- 公开 API ----

  async function init(serverConfigs: LspServerConfig[], root: string): Promise<void> {
    workspaceRoot = root;
    extensionMap.clear();
    servers.length = 0;
    brokenServers.clear();

    for (const config of serverConfigs) {
      const extensions = config.extensions ?? [];
      const languageIds = config.languageIds ?? [];

      const instance = createLspServerInstance({
        serverId: config.name,
        clientConfig: {
          command: config.command,
          args: config.args ?? undefined,
          env: config.env ?? undefined,
          connectTimeoutMs: config.connectTimeoutMs ?? undefined,
          requestTimeoutMs: config.requestTimeoutMs ?? undefined,
        },
        languageIds,
        extensions,
        initializationOptions: config.initializationOptions,
      });

      servers.push(instance);

      // 注册扩展名映射
      for (const ext of extensions) {
        const normalized = ext.toLowerCase();
        if (!extensionMap.has(normalized)) {
          extensionMap.set(normalized, instance);
        }
      }
    }

    initialized = true;
  }

  async function onFileOpened(filePath: string, content: string): Promise<void> {
    if (!initialized) return;

    const server = getServerForFile(filePath);
    if (!server) return;

    // 懒启动 server
    if (server.getState() === 'stopped' || server.getState() === 'error') {
      try {
        await server.initialize(`file://${workspaceRoot}`);
      } catch {
        brokenServers.add(server.getServerId());
        return;
      }
    }

    await ensureFileOpened(filePath, server, content);
  }

  async function onFileChanged(filePath: string, content: string): Promise<void> {
    const uri = `file://${filePath}`;
    const opened = openedFiles.get(uri);

    if (!opened) {
      // 文档未追踪为打开，先尝试打开
      await onFileOpened(filePath, content);
      return;
    }

    const server = servers.find((s) => s.getServerId() === opened.serverId);
    if (server && server.getState() === 'running') {
      await server.notifyDocumentChanged(uri, content);
    }
  }

  async function onFileClosed(filePath: string): Promise<void> {
    const uri = `file://${filePath}`;
    const opened = openedFiles.get(uri);

    if (opened) {
      const server = servers.find((s) => s.getServerId() === opened.serverId);
      if (server) {
        await server.notifyDocumentClosed(uri);
      }
      openedFiles.delete(uri);
    }
  }

  async function request<T>(filePath: string, method: string, params?: unknown): Promise<T> {
    if (!initialized) {
      throw new LspError('LSP manager not initialized', 'NOT_INITIALIZED');
    }

    const server = getServerForFile(filePath);
    if (!server) {
      throw new LspError(`No LSP server available for file: ${filePath}`, 'NO_SERVER');
    }

    // 懒启动 server
    if (server.getState() === 'stopped' || server.getState() === 'error') {
      try {
        await server.initialize(`file://${workspaceRoot}`);
      } catch (err) {
        brokenServers.add(server.getServerId());
        throw new LspError(
          `Failed to start LSP server for ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
          'SERVER_START_FAILED'
        );
      }
    }

    // 确保文档已打开
    await ensureFileOpened(filePath, server);

    return server.request<T>(method, params);
  }

  function getStatus(): LspManagerStatus {
    return {
      serverCount: servers.length,
      runningCount: servers.filter((s) => s.getState() === 'running').length,
      errorCount: brokenServers.size,
      servers: servers.map((s) => ({
        serverId: s.getServerId(),
        state: s.getState(),
        extensions: s.getExtensions(),
      })),
    };
  }

  async function shutdown(): Promise<void> {
    // 关闭所有打开文件
    for (const [uri] of openedFiles) {
      const opened = openedFiles.get(uri);
      if (opened) {
        const server = servers.find((s) => s.getServerId() === opened.serverId);
        if (server) {
          try {
            await server.notifyDocumentClosed(uri);
          } catch {
            // 忽略
          }
        }
      }
    }
    openedFiles.clear();

    // 关闭所有 server
    for (const server of servers) {
      try {
        await server.shutdown();
      } catch {
        // 忽略
      }
    }

    servers.length = 0;
    extensionMap.clear();
    brokenServers.clear();
    initialized = false;
  }

  return {
    init,
    onFileOpened,
    onFileChanged,
    onFileClosed,
    request,
    getServerForFile,
    getStatus,
    shutdown,
  };
}
