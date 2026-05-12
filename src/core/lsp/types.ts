/**
 * LSP 协议类型定义
 *
 * 自包含的 LSP 协议核心类型，不依赖外部 LSP 类型库。
 * 仅定义 zapmyco 需要的子集。
 *
 * @module core/lsp
 */

// ============ 基础类型 ============

/** LSP 位置（0-based） */
export interface LspPosition {
  line: number;
  character: number;
}

/** LSP 范围 */
export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

/** LSP 位置（含 URI） */
export interface LspLocation {
  uri: string;
  range: LspRange;
}

/** LSP 位置链接（带源范围） */
export interface LspLocationLink {
  originSelectionRange?: LspRange;
  targetUri: string;
  targetRange: LspRange;
  targetSelectionRange: LspRange;
}

// ============ 诊断 ============

/** 诊断严重级别 */
export type DiagnosticSeverity = 1 | 2 | 3 | 4;

/** LSP 诊断 */
export interface LspDiagnostic {
  range: LspRange;
  severity?: DiagnosticSeverity;
  code?: string | number;
  source?: string;
  message: string;
  relatedInformation?: Array<{
    location: LspLocation;
    message: string;
  }>;
}

/** 诊断发布参数 */
export interface PublishDiagnosticsParams {
  uri: string;
  diagnostics: LspDiagnostic[];
}

// ============ 悬停 ============

/** MarkedString 可以是字符串或带语言标记的代码块 */
export type MarkedString = string | { language: string; value: string };

/** Hover 内容 */
export interface LspHover {
  contents: MarkedString | MarkedString[] | { kind: 'markdown'; value: string };
  range?: LspRange;
}

// ============ 符号 ============

/** 符号类型枚举 */
export enum SymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

/** SymbolKind 名称映射 */
export const SYMBOL_KIND_NAMES: Record<number, string> = {
  [SymbolKind.File]: 'File',
  [SymbolKind.Module]: 'Module',
  [SymbolKind.Namespace]: 'Namespace',
  [SymbolKind.Package]: 'Package',
  [SymbolKind.Class]: 'Class',
  [SymbolKind.Method]: 'Method',
  [SymbolKind.Property]: 'Property',
  [SymbolKind.Field]: 'Field',
  [SymbolKind.Constructor]: 'Constructor',
  [SymbolKind.Enum]: 'Enum',
  [SymbolKind.Interface]: 'Interface',
  [SymbolKind.Function]: 'Function',
  [SymbolKind.Variable]: 'Variable',
  [SymbolKind.Constant]: 'Constant',
  [SymbolKind.String]: 'String',
  [SymbolKind.Number]: 'Number',
  [SymbolKind.Boolean]: 'Boolean',
  [SymbolKind.Array]: 'Array',
  [SymbolKind.Object]: 'Object',
  [SymbolKind.Key]: 'Key',
  [SymbolKind.Null]: 'Null',
  [SymbolKind.EnumMember]: 'EnumMember',
  [SymbolKind.Struct]: 'Struct',
  [SymbolKind.Event]: 'Event',
  [SymbolKind.Operator]: 'Operator',
  [SymbolKind.TypeParameter]: 'TypeParameter',
};

/** 文档符号（层次化） */
export interface LspDocumentSymbol {
  name: string;
  detail?: string;
  kind: SymbolKind;
  tags?: number[];
  deprecated?: boolean;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
}

/** 工作区符号（扁平） */
export interface LspWorkspaceSymbol {
  name: string;
  kind: SymbolKind;
  tags?: number[];
  deprecated?: boolean;
  location: LspLocation;
  containerName?: string;
}

// ============ 调用层次 ============

/** 调用层次项 */
export interface LspCallHierarchyItem {
  name: string;
  kind: SymbolKind;
  tags?: number[];
  detail?: string;
  uri: string;
  range: LspRange;
  selectionRange: LspRange;
  data?: unknown;
}

/** 传入调用 */
export interface LspCallHierarchyIncomingCall {
  from: LspCallHierarchyItem;
  fromRanges: LspRange[];
}

/** 传出调用 */
export interface LspCallHierarchyOutgoingCall {
  to: LspCallHierarchyItem;
  fromRanges: LspRange[];
}

// ============ 服务器能力 ============

/** LSP 服务器能力（zapmyco 需要的子集） */
export interface LspServerCapabilities {
  textDocumentSync?: unknown;
  definitionProvider?: boolean;
  referencesProvider?: boolean;
  hoverProvider?: boolean;
  documentSymbolProvider?: boolean;
  workspaceSymbolProvider?: boolean;
  implementationProvider?: boolean;
  callHierarchyProvider?: boolean;
}

/** initialize 响应 */
export interface InitializeResult {
  capabilities: LspServerCapabilities;
  serverInfo?: {
    name: string;
    version?: string;
  };
}

// ============ 服务器配置 ============

/** 单个 LSP 服务器配置 */
export interface LspServerConfig {
  /** 唯一名称 */
  name: string;
  /** 启动命令 */
  command: string;
  /** 命令参数 */
  args?: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 文件扩展名（优先使用此字段进行路由） */
  extensions?: string[];
  /** 支持的语言 ID 列表 */
  languageIds?: string[];
  /** 初始化选项 */
  initializationOptions?: unknown;
  /** 是否启用 */
  enabled?: boolean;
  /** 连接超时（毫秒） */
  connectTimeoutMs?: number;
  /** 请求超时（毫秒） */
  requestTimeoutMs?: number;
}

/** LSP 全局配置 */
export interface LspConfig {
  /** 是否启用 LSP 功能 */
  enabled: boolean;
  /** LSP 服务器配置列表 */
  servers?: LspServerConfig[];
}

// ============ 服务器状态 ============

/** 服务器运行状态 */
export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

/** 管理器状态概览 */
export interface LspManagerStatus {
  serverCount: number;
  runningCount: number;
  errorCount: number;
  servers: Array<{
    serverId: string;
    state: ServerState;
    extensions: string[];
  }>;
}

// ============ 错误类型 ============

/** LSP 操作错误 */
export class LspError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'LspError';
    this.code = code;
  }
}
