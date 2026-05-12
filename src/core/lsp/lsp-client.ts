/**
 * LSP 客户端 — Layer 1
 *
 * 启动 LSP 语言服务器子进程，通过 stdio 进行 JSON-RPC 2.0 通信。
 *
 * @module core/lsp
 */

import { type ChildProcess, spawn } from 'node:child_process';
import {
  createMessageReader,
  createMessageWriter,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './json-rpc';
import type { InitializeResult, LspServerCapabilities } from './types';
import { LspError } from './types';

// ============ 类型 ============

export interface LspClientConfig {
  command: string;
  args?: string[] | undefined;
  env?: Record<string, string> | undefined;
  connectTimeoutMs?: number | undefined;
  requestTimeoutMs?: number | undefined;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

export interface LspClient {
  sendRequest<T = unknown>(method: string, params?: unknown): Promise<T>;
  sendNotification(method: string, params?: unknown): Promise<void>;
  onNotification(method: string, handler: (params: unknown) => void): void;
  offNotification(method: string, handler: (params: unknown) => void): void;
  initialize(rootUri: string, initializationOptions?: unknown): Promise<InitializeResult>;
  getCapabilities(): LspServerCapabilities | null;
  isAlive(): boolean;
  shutdown(): Promise<void>;
}

// ============ 实现 ============

export function createLspClient(config: LspClientConfig): LspClient {
  const requestTimeoutMs = config.requestTimeoutMs ?? 30000;

  let childProcess: ChildProcess | null = null;
  let nextId = 1;
  let isStopping = false;
  let capabilities: LspServerCapabilities | null = null;

  const pendingRequests = new Map<number | string, PendingRequest>();
  const notificationHandlers = new Map<string, Set<(params: unknown) => void>>();

  let messageWriter: ReturnType<typeof createMessageWriter> | null = null;

  // ---- 调试 ----

  function trace(dir: string, msg: string): void {
    if (process.env.ZAPMYCO_LSP_TRACE) {
      process.stderr.write(`[lsp-client] ${dir} ${msg}\n`);
    }
  }

  // ---- 拒绝所有待处理 ----

  function rejectAllPending(error: Error): void {
    for (const [, pending] of pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    pendingRequests.clear();
  }

  // ---- 消息处理 ----

  function handleMessage(message: JsonRpcMessage): void {
    // 响应（有 id 但无 method）
    if ('id' in message && !('method' in message)) {
      const response = message as JsonRpcResponse;
      const pending = pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRequests.delete(response.id);
        if (response.error) {
          pending.reject(
            new LspError(
              `LSP error ${response.error.code}: ${response.error.message}`,
              `LSP_ERROR_${response.error.code}`
            )
          );
        } else {
          pending.resolve(response.result);
        }
      }
      return;
    }

    // 通知（有 method 但无 id）
    if ('method' in message && !('id' in message)) {
      const notification = message as JsonRpcNotification;
      const handlers = notificationHandlers.get(notification.method);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(notification.params);
          } catch {
            // 静默忽略 handler 错误
          }
        }
      }
    }

    // 请求（有 method 也有 id）—— 忽略，客户端不处理请求
  }

  // ---- 启动子进程 ----

  function spawnProcess(): ChildProcess {
    const child = spawn(config.command, config.args ?? [], {
      env: { ...process.env, ...config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.on('error', (err) => {
      rejectAllPending(new LspError(`LSP process error: ${err.message}`, 'PROCESS_ERROR'));
    });

    child.on('exit', (code, signal) => {
      if (!isStopping) {
        const reason = signal ? `signal ${signal}` : `exit code ${code}`;
        rejectAllPending(
          new LspError(`LSP process exited unexpectedly (${reason})`, 'PROCESS_EXIT')
        );
      }
    });

    // stderr 日志
    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        if (process.env.ZAPMYCO_LSP_TRACE) {
          process.stderr.write(`[lsp-stderr] ${chunk.toString('utf-8')}`);
        }
      });
    }

    return child;
  }

  function ensureStarted(): void {
    if (childProcess) return;

    childProcess = spawnProcess();

    // 建立消息读取器（stdout）
    const reader = createMessageReader(
      handleMessage,
      (err) => trace('←', `Reader error: ${err.message}`),
      () => {
        if (!isStopping) {
          rejectAllPending(new LspError('LSP stdout closed', 'STDOUT_CLOSED'));
        }
      },
      (msg) => trace('←', msg)
    );

    childProcess.stdout!.on('data', (chunk: Buffer) => {
      reader.feed(chunk);
    });

    childProcess.stdout!.on('end', () => {
      if (!isStopping) {
        rejectAllPending(new LspError('LSP stdout closed unexpectedly', 'STDOUT_CLOSED'));
      }
    });

    // 建立消息写入器（stdin）
    messageWriter = createMessageWriter(childProcess.stdin!, (msg) => trace('→', msg));
  }

  // ---- 公开 API ----

  async function initialize(
    rootUri: string,
    initializationOptions?: unknown
  ): Promise<InitializeResult> {
    ensureStarted();

    const result = await sendRequest<InitializeResult>('initialize', {
      processId: process.pid,
      rootUri,
      rootPath: rootUri.replace(/^file:\/\//, ''),
      workspaceFolders: [{ uri: rootUri, name: 'workspace' }],
      capabilities: {
        textDocument: {
          synchronization: { didSave: true },
          definition: { linkSupport: true },
          references: {},
          hover: { contentFormat: ['markdown', 'plaintext'] },
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          implementation: { linkSupport: true },
          callHierarchy: {},
        },
        workspace: {
          symbol: {},
        },
      },
      initializationOptions,
    });

    capabilities = result.capabilities;

    await sendNotification('initialized', {});

    return result;
  }

  async function sendRequest<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!childProcess || !messageWriter) {
      throw new LspError('LSP client not started', 'NOT_STARTED');
    }
    if (isStopping) {
      throw new LspError('LSP client is shutting down', 'SHUTTING_DOWN');
    }

    const id = nextId++;
    const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new LspError(`LSP request timeout: ${method}`, 'REQUEST_TIMEOUT'));
      }, requestTimeoutMs);

      pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        method,
      });

      messageWriter!.write(request).catch((err) => {
        clearTimeout(timer);
        pendingRequests.delete(id);
        reject(err);
      });
    });
  }

  async function sendNotification(method: string, params?: unknown): Promise<void> {
    if (!childProcess || !messageWriter) {
      throw new LspError('LSP client not started', 'NOT_STARTED');
    }
    if (isStopping) return;

    const notification: JsonRpcNotification = { jsonrpc: '2.0', method, params };
    await messageWriter.write(notification);
  }

  function onNotification(method: string, handler: (params: unknown) => void): void {
    let handlers = notificationHandlers.get(method);
    if (!handlers) {
      handlers = new Set();
      notificationHandlers.set(method, handlers);
    }
    handlers.add(handler);
  }

  function offNotification(method: string, handler: (params: unknown) => void): void {
    const handlers = notificationHandlers.get(method);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) notificationHandlers.delete(method);
    }
  }

  function getCapabilities(): LspServerCapabilities | null {
    return capabilities;
  }

  function isAlive(): boolean {
    return childProcess !== null && !childProcess.killed && childProcess.exitCode === null;
  }

  async function shutdown(): Promise<void> {
    if (!childProcess || isStopping) return;
    isStopping = true;

    try {
      await sendRequest('shutdown');
    } catch {
      // shutdown 请求失败可忽略
    }

    try {
      await sendNotification('exit');
    } catch {
      // exit 通知失败可忽略
    }

    // 等待 2 秒优雅退出
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (childProcess && !childProcess.killed) {
          childProcess.kill('SIGKILL');
        }
        resolve();
      }, 2000);

      childProcess!.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    childProcess = null;
    capabilities = null;
    messageWriter = null;
    pendingRequests.clear();
    notificationHandlers.clear();
  }

  return {
    sendRequest,
    sendNotification,
    onNotification,
    offNotification,
    initialize,
    getCapabilities,
    isAlive,
    shutdown,
  };
}
