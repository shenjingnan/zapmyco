/**
 * LSP 代码智能系统
 *
 * 三层架构实现 Language Server Protocol 集成：
 * - Layer 1: LspClient — 子进程 + JSON-RPC 通信
 * - Layer 2: LspServerInstance — 单 server 状态机 + 重试
 * - Layer 3: LspServerManager — 多 server 路由 + 文档同步
 *
 * @module core/lsp
 */

export type {
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from './json-rpc';
export {
  createMessageReader,
  createMessageWriter,
} from './json-rpc';
export type { LspClient, LspClientConfig } from './lsp-client';
export { createLspClient } from './lsp-client';
export { BUILTIN_LSP_SERVERS, filterAvailableServers, resolveLspConfig } from './lsp-config';
export type { LspServerInstance, LspServerInstanceConfig } from './lsp-server-instance';
export { createLspServerInstance } from './lsp-server-instance';
export type { LspServerManager } from './lsp-server-manager';
export { createLspServerManager } from './lsp-server-manager';
export type {
  InitializeResult,
  LspCallHierarchyIncomingCall,
  LspCallHierarchyItem,
  LspCallHierarchyOutgoingCall,
  LspConfig,
  LspDiagnostic,
  LspDocumentSymbol,
  LspHover,
  LspLocation,
  LspLocationLink,
  LspManagerStatus,
  LspPosition,
  LspRange,
  LspServerCapabilities,
  LspServerConfig,
  LspWorkspaceSymbol,
  PublishDiagnosticsParams,
  ServerState,
} from './types';
export { LspError, SYMBOL_KIND_NAMES, SymbolKind } from './types';
