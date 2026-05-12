/**
 * JSON-RPC 2.0 消息读写器
 *
 * 自行实现 LSP 传输层（不依赖 vscode-jsonrpc），
 * 解析 Content-Length 头 + JSON body 格式的 stdio 消息。
 *
 * @module core/lsp
 */

import type { Writable } from 'node:stream';

// ============ JSON-RPC 类型 ============

/** JSON-RPC 2.0 请求 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

/** JSON-RPC 2.0 响应 */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** JSON-RPC 2.0 通知（无 id） */
export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

/** JSON-RPC 消息 */
export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// ============ 消息头常量 ============

const HEADER_CONTENT_LENGTH = 'Content-Length';
const HEADER_CONTENT_TYPE = 'Content-Type';
const DEFAULT_CONTENT_TYPE = 'application/vscode-jsonrpc; charset=utf-8';
const CRLF = '\r\n';
const DOUBLE_CRLF = '\r\n\r\n';

// ============ 消息读取器 ============

/**
 * 从 Readable 流（子进程 stdout）读取 JSON-RPC 消息。
 *
 * 处理 TCP 流特性：
 * - 消息可能分多个 chunk 到达
 * - 一个 chunk 可能包含多个消息
 * - Content-Length 头可能跨 chunk 边界
 */
export function createMessageReader(
  onMessage: (message: JsonRpcMessage) => void,
  onError: (error: Error) => void,
  _onClose: () => void,
  trace?: (msg: string) => void
): { feed(chunk: Buffer): void; reset(): void } {
  let buffer = '';
  let contentLength = -1;
  let headerEnd = -1;

  function parseHeaders(rawHeaders: string): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const line of rawHeaders.split(CRLF)) {
      const colon = line.indexOf(':');
      if (colon > 0) {
        const key = line.slice(0, colon).trim();
        const value = line.slice(colon + 1).trim();
        headers[key] = value;
      }
    }
    return headers;
  }

  function processBuffer(): void {
    while (buffer.length > 0) {
      // 如果还没有找到消息边界，尝试解析 header
      if (contentLength < 0) {
        headerEnd = buffer.indexOf(DOUBLE_CRLF);
        if (headerEnd < 0) {
          // header 还没完整到达
          return;
        }

        const rawHeaders = buffer.slice(0, headerEnd);
        const headers = parseHeaders(rawHeaders);

        const lengthStr = headers[HEADER_CONTENT_LENGTH];
        if (!lengthStr) {
          onError(new Error(`Missing ${HEADER_CONTENT_LENGTH} header in LSP message`));
          buffer = buffer.slice(headerEnd + 4);
          continue;
        }

        contentLength = parseInt(lengthStr, 10);
        if (Number.isNaN(contentLength) || contentLength < 0) {
          onError(new Error(`Invalid ${HEADER_CONTENT_LENGTH}: ${lengthStr}`));
          buffer = buffer.slice(headerEnd + 4);
          contentLength = -1;
          continue;
        }
      }

      // 检查 body 是否完整到达
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;

      if (buffer.length < bodyEnd) {
        // body 还没完整到达
        return;
      }

      // 提取 body JSON
      const body = buffer.slice(bodyStart, bodyEnd);
      buffer = buffer.slice(bodyEnd);
      contentLength = -1;
      headerEnd = -1;

      if (body.length === 0) continue;

      try {
        trace?.(`LSP ← ${body.slice(0, 500)}${body.length > 500 ? '...' : ''}`);
        const message = JSON.parse(body) as JsonRpcMessage;
        onMessage(message);
      } catch (err) {
        onError(new Error(`JSON parse error: ${err instanceof Error ? err.message : String(err)}`));
      }
    }
  }

  return {
    feed(chunk: Buffer): void {
      buffer += chunk.toString('utf-8');
      processBuffer();
    },
    reset(): void {
      buffer = '';
      contentLength = -1;
      headerEnd = -1;
    },
  };
}

// ============ 消息写入器 ============

/**
 * 向 Writable 流（子进程 stdin）写入 JSON-RPC 消息。
 * 自动添加 Content-Length 和 Content-Type 头。
 */
export function createMessageWriter(
  writable: Writable,
  trace?: (msg: string) => void
): { write(message: JsonRpcMessage): Promise<void> } {
  const encoder = new TextEncoder();

  async function write(message: JsonRpcMessage): Promise<void> {
    const body = JSON.stringify(message);
    const bodyBytes = encoder.encode(body);
    const header = `${HEADER_CONTENT_LENGTH}: ${bodyBytes.length}${CRLF}${HEADER_CONTENT_TYPE}: ${DEFAULT_CONTENT_TYPE}${CRLF}${CRLF}`;
    const headerBytes = encoder.encode(header);

    const fullMessage = Buffer.concat([headerBytes, bodyBytes]);
    trace?.(`LSP → ${body.slice(0, 500)}${body.length > 500 ? '...' : ''}`);

    return new Promise<void>((resolve, reject) => {
      if (!writable.writable) {
        reject(new Error('Stream is not writable'));
        return;
      }
      writable.write(fullMessage, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  return { write };
}
