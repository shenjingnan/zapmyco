/**
 * LSP 服务器实例 — Layer 2
 *
 * 封装单个 LSP 服务器的完整生命周期：
 * - 状态机（stopped → starting → running → stopping → stopped + error）
 * - initialize 握手（capabilities 提取）
 * - 文档同步跟踪（didOpen/didChange/didClose）
 * - 重试逻辑（指数退避，最大 maxRetries 次）
 * - 能力查询
 *
 * @module core/lsp
 */

import { createLspClient, type LspClient, type LspClientConfig } from './lsp-client';
import type { LspServerCapabilities, ServerState } from './types';
import { LspError } from './types';

// ============ 配置 ============

export interface LspServerInstanceConfig {
  serverId: string;
  clientConfig: LspClientConfig;
  languageIds: string[];
  extensions: string[];
  initializationOptions?: unknown | undefined;
  maxRetries?: number | undefined;
  retryBaseDelayMs?: number | undefined;
}

// ============ 实例接口 ============

export interface LspServerInstance {
  /** 初始化握手 */
  initialize(rootUri: string): Promise<void>;
  /** 优雅关闭 */
  shutdown(): Promise<void>;
  /** 文档打开（幂等） */
  ensureDocumentOpened(uri: string, languageId: string, text: string): Promise<void>;
  /** 文档变更通知 */
  notifyDocumentChanged(uri: string, text: string): Promise<void>;
  /** 文档关闭通知 */
  notifyDocumentClosed(uri: string): Promise<void>;
  /** 发送 LSP 请求（自动确保 server 处于 running 状态） */
  request<T>(method: string, params?: unknown): Promise<T>;
  /** 发送 LSP 通知 */
  sendNotification(method: string, params?: unknown): Promise<void>;
  /** 注册通知处理器 */
  onNotification(method: string, handler: (params: unknown) => void): void;
  /** 获取健康状态 */
  getHealth(): { state: ServerState; requestCount: number; errorCount: number };
  /** 查询能力 */
  supportsCapability(capability: string): boolean;
  /** 获取当前状态 */
  getState(): ServerState;
  /** 获取 server ID */
  getServerId(): string;
  /** 获取支持的文件扩展名 */
  getExtensions(): string[];
  /** 获取支持的语言 ID */
  getLanguageIds(): string[];
}

// ============ 实现 ============

export function createLspServerInstance(config: LspServerInstanceConfig): LspServerInstance {
  const { serverId, languageIds, extensions, initializationOptions } = config;
  const maxRetries = config.maxRetries ?? 3;
  const retryBaseDelayMs = config.retryBaseDelayMs ?? 1000;

  let client: LspClient | null = null;
  let capabilities: LspServerCapabilities | null = null;
  let state: ServerState = 'stopped';
  let retryCount = 0;
  let requestCount = 0;
  let errorCount = 0;

  // 已打开的文档追踪：URI → { version }
  const openedDocuments = new Map<string, { version: number }>();

  // ---- 状态管理 ----

  function transition(newState: ServerState): void {
    state = newState;
  }

  function calculateDelay(): number {
    return Math.min(retryBaseDelayMs * 2 ** retryCount, 30000);
  }

  // ---- 文档同步 ----

  async function ensureDocumentOpened(
    uri: string,
    languageId: string,
    text: string
  ): Promise<void> {
    const existing = openedDocuments.get(uri);
    if (existing) {
      // 已打开
      return;
    }

    await ensureRunning();

    try {
      await client?.sendNotification('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId,
          version: 1,
          text,
        },
      });
      openedDocuments.set(uri, { version: 1 });
    } catch (err) {
      // didOpen 失败不阻塞，后续操作仍可尝试
      if (process.env.ZAPMYCO_LSP_TRACE) {
        process.stderr.write(
          `[lsp-instance] didOpen failed: ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
    }
  }

  async function notifyDocumentChanged(uri: string, text: string): Promise<void> {
    const existing = openedDocuments.get(uri);
    if (!existing) {
      // 如果文档没被追踪为打开，先发送 didOpen
      return;
    }

    existing.version++;
    const version = existing.version;

    if (state !== 'running' || !client?.isAlive()) return;

    try {
      await client.sendNotification('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    } catch {
      // didChange 失败不阻塞
    }
  }

  async function notifyDocumentClosed(uri: string): Promise<void> {
    openedDocuments.delete(uri);

    if (state !== 'running' || !client?.isAlive()) return;

    try {
      await client.sendNotification('textDocument/didClose', {
        textDocument: { uri },
      });
    } catch {
      // didClose 失败不阻塞
    }
  }

  // ---- 初始化 ----

  async function ensureRunning(): Promise<void> {
    if (state === 'running' && client?.isAlive()) return;

    if (state === 'stopped' || state === 'error') {
      await doInitialize();
    }
  }

  async function doInitialize(rootUri?: string): Promise<void> {
    if (state === 'starting') {
      // 已经在启动中，等待
      return;
    }

    transition('starting');

    try {
      // 关闭旧客户端
      if (client) {
        try {
          await client.shutdown();
        } catch {
          // 忽略
        }
      }

      client = createLspClient(config.clientConfig);

      const uri = rootUri ?? `file://${process.cwd()}`;
      const result = await client.initialize(uri, initializationOptions);

      capabilities = result.capabilities;
      retryCount = 0;
      transition('running');
    } catch (err) {
      errorCount++;
      const error = err instanceof Error ? err : new Error(String(err));

      if (retryCount < maxRetries) {
        retryCount++;
        const delay = calculateDelay();
        if (process.env.ZAPMYCO_LSP_TRACE) {
          process.stderr.write(
            `[lsp-instance] ${serverId} init failed, retry ${retryCount}/${maxRetries} in ${delay}ms\n`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        // 重试
        retryCount--;
        transition('error');
        return doInitialize(rootUri);
      }

      transition('error');
      throw new LspError(
        `Failed to initialize LSP server ${serverId}: ${error.message}`,
        'INIT_FAILED'
      );
    }
  }

  async function initialize(rootUri: string): Promise<void> {
    await doInitialize(rootUri);
  }

  // ---- 请求/通知 ----

  async function request<T>(method: string, params?: unknown): Promise<T> {
    await ensureRunning();
    requestCount++;

    if (!client) {
      throw new LspError('CLIENT_NOT_INITIALIZED', 'LSP 客户端未初始化');
    }

    try {
      const result = await client.sendRequest<T>(method, params);
      return result;
    } catch (err) {
      errorCount++;

      // 对于 transient 错误，标记为 error 以触发下次重连
      if (err instanceof LspError && err.code === 'PROCESS_EXIT') {
        transition('error');
      }

      throw err;
    }
  }

  async function sendNotification(method: string, params?: unknown): Promise<void> {
    if (state !== 'running' || !client?.isAlive()) return;

    try {
      await client.sendNotification(method, params);
    } catch {
      // 通知失败不抛出
    }
  }

  function onNotification(method: string, handler: (params: unknown) => void): void {
    // 延迟绑定：如果 client 尚未创建，在下次 initialize 时注册
    if (client) {
      client.onNotification(method, handler);
    }
    // 注意：这里只处理已存在的 client。需要在 client 创建后重新注册。
    // 简化处理：调用方应在 initialize 之后注册通知。
  }

  // ---- 健康/能力 ----

  function supportsCapability(capability: string): boolean {
    if (!capabilities) return false;
    return (capabilities as Record<string, unknown>)[capability] === true;
  }

  function getHealth(): { state: ServerState; requestCount: number; errorCount: number } {
    return { state, requestCount, errorCount };
  }

  function getState(): ServerState {
    return state;
  }

  function getServerId(): string {
    return serverId;
  }

  function getExtensions(): string[] {
    return extensions;
  }

  function getLanguageIds(): string[] {
    return languageIds;
  }

  // ---- 关闭 ----

  async function shutdown(): Promise<void> {
    if (state === 'stopped' || state === 'stopping') return;

    transition('stopping');

    // 关闭所有打开文档
    for (const [uri] of openedDocuments) {
      try {
        await client?.sendNotification('textDocument/didClose', {
          textDocument: { uri },
        });
      } catch {
        // 忽略
      }
    }
    openedDocuments.clear();

    if (client) {
      try {
        await client.shutdown();
      } catch {
        // 强制清理
      }
    }

    client = null;
    capabilities = null;
    transition('stopped');
  }

  return {
    initialize,
    shutdown,
    ensureDocumentOpened,
    notifyDocumentChanged,
    notifyDocumentClosed,
    request,
    sendNotification,
    onNotification,
    getHealth,
    supportsCapability,
    getState,
    getServerId,
    getExtensions,
    getLanguageIds,
  };
}
