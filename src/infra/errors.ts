/**
 * zapmyco 统一错误类型
 *
 * 所有模块应使用或继承这些错误类型，确保错误信息一致且可追踪。
 */

/** 错误码枚举 */
export enum ZapmycoErrorCode {
  // 意图理解相关
  INTENT_PARSE_FAILED = 'INTENT_PARSE_FAILED',
  INTENT_LOW_CONFIDENCE = 'INTENT_LOW_CONFIDENCE',

  // 任务拆分相关
  DECOMPOSE_FAILED = 'DECOMPOSE_FAILED',
  DECOMPOSE_INVALID_GRAPH = 'DECOMPOSE_INVALID_GRAPH',

  // 调度相关
  SCHEDULER_NO_AVAILABLE_AGENT = 'SCHEDULER_NO_AVAILABLE_AGENT',
  SCHEDULER_CAPABILITY_MISMATCH = 'SCHEDULER_CAPABILITY_MISMATCH',
  SCHEDULER_TASK_TIMEOUT = 'SCHEDULER_TASK_TIMEOUT',

  // Agent 相关
  AGENT_NOT_FOUND = 'AGENT_NOT_FOUND',
  AGENT_OFFLINE = 'AGENT_OFFLINE',
  AGENT_EXECUTION_FAILED = 'AGENT_EXECUTION_FAILED',
  AGENT_HEALTH_CHECK_FAILED = 'AGENT_HEALTH_CHECK_FAILED',

  // 配置相关
  CONFIG_LOAD_FAILED = 'CONFIG_LOAD_FAILED',
  CONFIG_INVALID = 'CONFIG_INVALID',

  // LLM 相关
  LLM_API_ERROR = 'LLM_API_ERROR',
  LLM_RATE_LIMITED = 'LLM_RATE_LIMITED',
  LLM_QUOTA_EXCEEDED = 'LLM_QUOTA_EXCEEDED',

  // 通用
  UNKNOWN = 'UNKNOWN',
  INTERNAL_ERROR = 'INTERNAL_ERROR',

  // Web 工具相关
  WEB_FETCH_FAILED = 'WEB_FETCH_FAILED',
  WEB_FETCH_BLOCKED = 'WEB_FETCH_BLOCKED',
  WEB_FETCH_TIMEOUT = 'WEB_FETCH_TIMEOUT',
  WEB_FETCH_TOO_LARGE = 'WEB_FETCH_TOO_LARGE',
  WEB_SEARCH_FAILED = 'WEB_SEARCH_FAILED',
  WEB_SEARCH_NOT_CONFIGURED = 'WEB_SEARCH_NOT_CONFIGURED',
  WEB_SEARCH_QUOTA_EXCEEDED = 'WEB_SEARCH_QUOTA_EXCEEDED',
  WEB_INVALID_URL = 'WEB_INVALID_URL',
}

/**
 * zapmyco 基础错误类
 *
 * 所有业务错误都应继承此类，提供结构化的错误信息。
 */
export class ZapmycoError extends Error {
  /** 错误码 */
  readonly code: ZapmycoErrorCode;
  /** 额外的上下文信息 */
  readonly context?: Record<string, unknown>;

  constructor(code: ZapmycoErrorCode, message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'ZapmycoError';
    this.code = code;
    Object.assign(this, context !== undefined ? { context } : {});

    // 保持正确的原型链（ES5+ 兼容）
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** 转换为可序列化的对象 */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      stack: this.stack,
    };
  }
}

/** 意图理解错误 */
export class IntentError extends ZapmycoError {
  constructor(
    code: ZapmycoErrorCode.INTENT_PARSE_FAILED | ZapmycoErrorCode.INTENT_LOW_CONFIDENCE,
    message: string,
    context?: Record<string, unknown>
  ) {
    super(code, message, context);
    this.name = 'IntentError';
  }
}

/** 任务拆分错误 */
export class DecomposeError extends ZapmycoError {
  constructor(
    code: ZapmycoErrorCode.DECOMPOSE_FAILED | ZapmycoErrorCode.DECOMPOSE_INVALID_GRAPH,
    message: string,
    context?: Record<string, unknown>
  ) {
    super(code, message, context);
    this.name = 'DecomposeError';
  }
}

/** 调度错误 */
export class SchedulerError extends ZapmycoError {
  constructor(
    code:
      | ZapmycoErrorCode.SCHEDULER_NO_AVAILABLE_AGENT
      | ZapmycoErrorCode.SCHEDULER_CAPABILITY_MISMATCH
      | ZapmycoErrorCode.SCHEDULER_TASK_TIMEOUT,
    message: string,
    context?: Record<string, unknown>
  ) {
    super(code, message, context);
    this.name = 'SchedulerError';
  }
}

/** Agent 执行错误 */
export class AgentError extends ZapmycoError {
  constructor(
    code:
      | ZapmycoErrorCode.AGENT_NOT_FOUND
      | ZapmycoErrorCode.AGENT_OFFLINE
      | ZapmycoErrorCode.AGENT_EXECUTION_FAILED
      | ZapmycoErrorCode.AGENT_HEALTH_CHECK_FAILED,
    message: string,
    context?: Record<string, unknown>
  ) {
    super(code, message, context);
    this.name = 'AgentError';
  }
}

/** LLM 调用错误 */
export class LlmError extends ZapmycoError {
  constructor(
    code:
      | ZapmycoErrorCode.LLM_API_ERROR
      | ZapmycoErrorCode.LLM_RATE_LIMITED
      | ZapmycoErrorCode.LLM_QUOTA_EXCEEDED,
    message: string,
    context?: Record<string, unknown>
  ) {
    super(code, message, context);
    this.name = 'LlmError';
  }
}

/** Web 工具错误 */
export class WebError extends ZapmycoError {
  constructor(
    code:
      | ZapmycoErrorCode.WEB_FETCH_FAILED
      | ZapmycoErrorCode.WEB_FETCH_BLOCKED
      | ZapmycoErrorCode.WEB_FETCH_TIMEOUT
      | ZapmycoErrorCode.WEB_FETCH_TOO_LARGE
      | ZapmycoErrorCode.WEB_SEARCH_FAILED
      | ZapmycoErrorCode.WEB_SEARCH_NOT_CONFIGURED
      | ZapmycoErrorCode.WEB_SEARCH_QUOTA_EXCEEDED
      | ZapmycoErrorCode.WEB_INVALID_URL,
    message: string,
    context?: Record<string, unknown>
  ) {
    super(code, message, context);
    this.name = 'WebError';
  }
}
