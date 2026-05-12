#!/usr/bin/env node
/**
 * Fake LSP Server — 用于集成测试的 JSON-RPC 2.0 测试替身
 *
 * 通过 stdio (stdin/stdout) 接收 JSON-RPC 请求并返回预设响应。
 * 支持 LSP 核心方法：initialize, textDocument/definition,
 * textDocument/references, textDocument/hover, textDocument/documentSymbol 等。
 */

const { stdin, stdout } = require('process');

const HEADER_CONTENT_LENGTH = 'Content-Length';

// ---- 常量 ----

const SAMPLE_DEFINITIONS = [
  {
    uri: 'file:///project/src/index.ts',
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
  },
  {
    uri: 'file:///project/src/utils.ts',
    range: { start: { line: 5, character: 2 }, end: { line: 5, character: 10 } },
  },
];

const SAMPLE_REFERENCES = [
  {
    uri: 'file:///project/src/caller.ts',
    range: { start: { line: 3, character: 4 }, end: { line: 3, character: 10 } },
  },
  {
    uri: 'file:///project/src/index.ts',
    range: { start: { line: 10, character: 2 }, end: { line: 10, character: 8 } },
  },
];

const SAMPLE_HOVER = {
  contents: { kind: 'markdown', value: '```typescript\nconst foo: string\n```\n\nA sample variable.' },
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
};

const SAMPLE_DOCUMENT_SYMBOLS = [
  {
    name: 'MyClass',
    kind: 5, // Class
    range: { start: { line: 0, character: 0 }, end: { line: 10, character: 1 } },
    selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 13 } },
    children: [
      {
        name: 'myMethod',
        kind: 6, // Method
        range: { start: { line: 2, character: 2 }, end: { line: 4, character: 3 } },
        selectionRange: { start: { line: 2, character: 9 }, end: { line: 2, character: 17 } },
      },
    ],
  },
];

const SAMPLE_WORKSPACE_SYMBOLS = [
  {
    name: 'MyClass',
    kind: 5,
    location: {
      uri: 'file:///project/src/MyClass.ts',
      range: { start: { line: 0, character: 0 }, end: { line: 10, character: 1 } },
    },
    containerName: 'src',
  },
];

const SAMPLE_IMPLEMENTATIONS = [
  {
    uri: 'file:///project/src/impl.ts',
    range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
  },
];

const SAMPLE_CALL_HIERARCHY_ITEM = [
  {
    name: 'myFunction',
    kind: 12, // Function
    uri: 'file:///project/src/index.ts',
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
    selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
  },
];

const SAMPLE_INCOMING_CALLS = [
  {
    from: {
      name: 'callerA',
      kind: 12,
      uri: 'file:///project/src/caller.ts',
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 7 } },
      selectionRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 7 } },
    },
    fromRanges: [{ start: { line: 3, character: 2 }, end: { line: 3, character: 9 } }],
  },
];

const SAMPLE_OUTGOING_CALLS = [
  {
    to: {
      name: 'calleeB',
      kind: 12,
      uri: 'file:///project/src/callee.ts',
      range: { start: { line: 5, character: 0 }, end: { line: 5, character: 7 } },
      selectionRange: { start: { line: 5, character: 0 }, end: { line: 5, character: 7 } },
    },
    fromRanges: [{ start: { line: 0, character: 5 }, end: { line: 0, character: 10 } }],
  },
];

const SAMPLE_DIAGNOSTICS = [
  {
    range: { start: { line: 2, character: 0 }, end: { line: 2, character: 10 } },
    severity: 1, // Error
    message: 'Cannot find name "foo"',
    source: 'fake-lsp',
  },
];

// ---- JSON-RPC 消息处理 ----

/** @type {Record<string, (params: unknown) => unknown>} */
const methodHandlers = {
  initialize: (params) => ({
    capabilities: {
      textDocumentSync: 1,
      definitionProvider: true,
      referencesProvider: true,
      hoverProvider: true,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      implementationProvider: true,
      callHierarchyProvider: true,
    },
    serverInfo: { name: 'fake-lsp-server', version: '1.0.0' },
  }),

  'textDocument/definition': () => SAMPLE_DEFINITIONS,
  'textDocument/references': () => SAMPLE_REFERENCES,
  'textDocument/hover': () => SAMPLE_HOVER,
  'textDocument/documentSymbol': () => SAMPLE_DOCUMENT_SYMBOLS,
  'workspace/symbol': () => SAMPLE_WORKSPACE_SYMBOLS,
  'textDocument/implementation': () => SAMPLE_IMPLEMENTATIONS,
  'textDocument/prepareCallHierarchy': () => SAMPLE_CALL_HIERARCHY_ITEM,
  'callHierarchy/incomingCalls': () => SAMPLE_INCOMING_CALLS,
  'callHierarchy/outgoingCalls': () => SAMPLE_OUTGOING_CALLS,

  shutdown: () => null,

  // Window 通知被服务器忽略（这些是客户端发来的通知）
  'initialized': () => undefined,
  'textDocument/didOpen': () => undefined,
  'textDocument/didChange': () => undefined,
  'textDocument/didClose': () => undefined,
  'exit': () => undefined,
};

// ---- JSON-RPC 传输 ----

/** @type {string} */
let buffer = '';

/**
 * 解析 Content-Length 头并从 stdin 提取完整消息
 * @returns {string[]} 完整 JSON 消息体数组
 */
function parseMessages() {
  const messages = [];
  while (buffer.length > 0) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) break;

    const rawHeaders = buffer.slice(0, headerEnd);
    const headers = {};
    for (const line of rawHeaders.split('\r\n')) {
      const colon = line.indexOf(':');
      if (colon > 0) {
        headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
      }
    }

    const contentLength = parseInt(headers[HEADER_CONTENT_LENGTH], 10);
    if (isNaN(contentLength)) {
      // 跳过无效消息
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }

    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + contentLength;
    if (buffer.length < bodyEnd) break;

    const body = buffer.slice(bodyStart, bodyEnd);
    buffer = buffer.slice(bodyEnd);
    messages.push(body);
  }
  return messages;
}

/**
 * 发送 JSON-RPC 响应
 * @param {number|string} id
 * @param {unknown} result
 */
function sendResponse(id, result) {
  const response = JSON.stringify({ jsonrpc: '2.0', id, result });
  const length = Buffer.byteLength(response, 'utf-8');
  stdout.write(`Content-Length: ${length}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n${response}`);
}

/**
 * 发送 JSON-RPC 通知
 * @param {string} method
 * @param {unknown} params
 */
function sendNotification(method, params) {
  const notification = JSON.stringify({ jsonrpc: '2.0', method, params });
  const length = Buffer.byteLength(notification, 'utf-8');
  stdout.write(`Content-Length: ${length}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n${notification}`);
}

/**
 * 发送 JSON-RPC 错误响应
 * @param {number|string} id
 * @param {number} code
 * @param {string} message
 */
function sendError(id, code, message) {
  const response = JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  });
  const length = Buffer.byteLength(response, 'utf-8');
  stdout.write(`Content-Length: ${length}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n${response}`);
}

/**
 * 处理单条 JSON-RPC 消息
 * @param {object} msg
 */
function handleMessage(msg) {
  if ('method' in msg && 'id' in msg) {
    // 这是请求
    const method = msg.method;
    const handler = methodHandlers[method];

    if (!handler) {
      sendError(msg.id, -32601, `Method not found: ${method}`);
      return;
    }

    try {
      const result = handler(msg.params) ?? null;
      if (result !== undefined) {
        sendResponse(msg.id, result);
      }
    } catch (err) {
      sendError(msg.id, -32603, err.message || String(err));
    }
  } else if ('method' in msg) {
    // 通知（无 id）
    const method = msg.method;
    const handler = methodHandlers[method];
    if (handler) {
      try {
        handler(msg.params);
      } catch (_) {
        // 静默忽略通知处理错误
      }
    }

    // 特殊处理：exit 通知后退出
    if (method === 'exit') {
      process.exit(0);
    }
  }
}

// ---- 主循环 ----

// stdin 读取循环
stdin.setEncoding('utf-8');
stdin.on('data', (chunk) => {
  buffer += chunk;
  const messages = parseMessages();
  for (const msg of messages) {
    try {
      const parsed = JSON.parse(msg);
      handleMessage(parsed);
    } catch (err) {
      // JSON 解析错误 — 忽略
    }
  }
});

stdin.on('end', () => {
  process.exit(0);
});

// 防止僵尸进程：超时后自动退出
const EXIT_TIMEOUT_MS = 30000;
setTimeout(() => {
  process.exit(0);
}, EXIT_TIMEOUT_MS);

// ---- 暴露给测试使用的内置功能 ----
// 测试可以通过 stdin 发送特殊命令来控制行为

// 特殊测试命令：
// - initialize 后自动发送 textDocument/publishDiagnostics
// 我们通过监听 initialized 通知来实现
const originalInitialized = methodHandlers['initialized'];
methodHandlers['initialized'] = (params) => {
  if (originalInitialized) originalInitialized(params);
  // 延迟发送诊断通知
  setTimeout(() => {
    sendNotification('textDocument/publishDiagnostics', {
      uri: 'file:///project/src/index.ts',
      diagnostics: SAMPLE_DIAGNOSTICS,
    });
  }, 50);
};
