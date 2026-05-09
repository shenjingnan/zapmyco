/**
 * 上下文溢出错误恢复
 *
 * 当 API 返回上下文溢出错误（400/413）时，
 * 执行紧急压缩并自动重试。
 *
 * @module core/context
 */

/** 上下文溢出错误匹配模式 */
const CONTEXT_OVERFLOW_PATTERNS = [
  /context.?length/i,
  /context.?size/i,
  /maximum.?context/i,
  /prompt.?too.?long/i,
  /413/i,
  /context_length_exceeded/i,
  /request.?too.?large/i,
  /input.?too.?long/i,
  /exceeds.?context/i,
  /exceeds.?the.?maximum/i,
  /token.?limit/i,
  /max.?tokens/i,
  /reduce.?the.?length/i,
];

/**
 * 检测错误是否为上下文溢出
 */
export function isContextOverflowError(error: unknown): boolean {
  if (!error) return false;

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';

  if (!message) return false;

  return CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * 检测错误中的 HTTP 状态码
 */
export function extractHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;

  const err = error as Record<string, unknown>;

  // 尝试多种可能的 status 字段
  for (const key of ['status', 'statusCode', 'httpStatus', 'code']) {
    const val = err[key];
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const num = Number.parseInt(val, 10);
      if (!Number.isNaN(num)) return num;
    }
  }
  return undefined;
}

/**
 * 上下文溢出错误恢复器
 *
 * 提供错误驱动的紧急压缩能力。
 */
export class ContextErrorRecovery {
  /** 最大紧急压缩尝试次数 */
  private maxAttempts: number;
  /** 连续紧急压缩计数 */
  private consecutiveAttempts = 0;

  constructor(maxAttempts = 3) {
    this.maxAttempts = maxAttempts;
  }

  /**
   * 检测是否需要进行错误恢复压缩
   */
  shouldRecover(error: unknown): boolean {
    const isOverflow = isContextOverflowError(error);
    const status = extractHttpStatus(error);

    // 明确是 400 或 413 + 上下文溢出模式
    if (isOverflow && (status === undefined || status === 400 || status === 413)) {
      return this.consecutiveAttempts < this.maxAttempts;
    }

    return false;
  }

  /**
   * 准备紧急压缩
   *
   * 使用更激进的参数：保护更少的消息
   */
  prepareRecovery(): {
    /** 增大了的保护尾数 */
    attempt: number;
    /** 更少的保护消息数 */
    protectLastMessages: number;
    /** 更低的阈值 */
    thresholdPercent: number;
  } {
    this.consecutiveAttempts++;

    // 每次尝试都进一步减少保护
    const protectLastMessages = Math.max(5, 20 - this.consecutiveAttempts * 5);

    const thresholdPercent = Math.max(0.3, 0.7 - this.consecutiveAttempts * 0.15);

    return {
      attempt: this.consecutiveAttempts,
      protectLastMessages,
      thresholdPercent,
    };
  }

  /**
   * 重置计数器（压缩成功后调用）
   */
  reset(): void {
    this.consecutiveAttempts = 0;
  }

  /**
   * 判断是否已耗尽重试次数
   */
  get isExhausted(): boolean {
    return this.consecutiveAttempts >= this.maxAttempts;
  }

  /**
   * 获取人类可读的恢复状态
   */
  getStatus(): string {
    return `紧急恢复: ${this.consecutiveAttempts}/${this.maxAttempts} 次尝试`;
  }
}
