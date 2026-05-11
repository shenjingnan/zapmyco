/**
 * Doom Loop 检测器
 *
 * 检测 Agent 陷入无效循环的模式：
 * 1. 重复相同工具调用（同一工具 + 相同参数）
 * 2. 连续工具执行失败
 * 3. 速率限制（单位时间内调用次数过多）
 *
 * 参考 Hermes (tool_guardrails.py) 和 OpenCode (doom_loop) 的设计。
 *
 * @module security/doom-loop-detector
 */

import { logger } from '@/infra/logger';

const log = logger.child('doom-loop');

// ============ 类型定义 ============

/** Doom Loop 检测器配置 */
export interface DoomLoopConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 连续相同调用触发警告的次数（默认 3） */
  maxRepeatedCalls: number;
  /** 连续失败触发警告的次数（默认 5） */
  maxConsecutiveFailures: number;
  /** 速率限制窗口（秒，默认 60） */
  rateWindowSec: number;
  /** 每个窗口最大调用次数（默认 50） */
  maxCallsPerWindow: number;
}

/** 调用记录 */
interface CallRecord {
  toolId: string;
  /** 参数签名（JSON 序列化后的哈希，用于检测相同调用） */
  paramSignature: string;
  timestamp: number;
}

/** Doom Loop 检查结果 */
export interface DoomLoopResult {
  /** 是否检测到循环 */
  detected: boolean;
  /** 检测原因 */
  reason?: string;
  /** 检测类型 */
  type?: 'repeated-call' | 'consecutive-failure' | 'rate-limit';
  /** 是否需要阻止执行 */
  shouldBlock: boolean;
}

// ============ 默认配置 ============

export const DEFAULT_DOOM_LOOP_CONFIG: DoomLoopConfig = {
  enabled: true,
  maxRepeatedCalls: 3,
  maxConsecutiveFailures: 5,
  rateWindowSec: 60,
  maxCallsPerWindow: 50,
};

// ============ DoomLoopDetector 实现 ============

export class DoomLoopDetector {
  private config: DoomLoopConfig;
  private recentCalls: CallRecord[] = [];
  private consecutiveFailures = 0;
  private consecutiveSameCall = 0;
  private lastCallSignature: string | null = null;
  private totalTriggers = 0;

  constructor(config?: Partial<DoomLoopConfig>) {
    this.config = { ...DEFAULT_DOOM_LOOP_CONFIG, ...config };
  }

  /**
   * 记录一次工具调用。返回是否检测到循环。
   *
   * 在工具执行**前**调用。
   */
  recordCall(toolId: string, params: Record<string, unknown>): DoomLoopResult {
    if (!this.config.enabled) {
      return { detected: false, shouldBlock: false };
    }

    const now = Date.now();
    const paramSignature = this.hashParams(params);
    const callSignature = `${toolId}:${paramSignature}`;

    // 记录调用
    this.recentCalls.push({ toolId, paramSignature, timestamp: now });

    // 清理过期记录
    this.pruneOldCalls(now);

    // 检查 1: 重复相同调用
    if (callSignature === this.lastCallSignature) {
      this.consecutiveSameCall++;
      if (this.consecutiveSameCall >= this.config.maxRepeatedCalls) {
        this.totalTriggers++;
        log.warn('检测到重复相同调用 (doom loop)', {
          toolId,
          consecutiveCount: this.consecutiveSameCall,
          threshold: this.config.maxRepeatedCalls,
        });
        return {
          detected: true,
          type: 'repeated-call',
          reason: `连续 ${this.consecutiveSameCall} 次相同工具调用（${toolId}），已触发循环检测`,
          shouldBlock: this.consecutiveSameCall >= this.config.maxRepeatedCalls + 2,
        };
      }
    } else {
      this.consecutiveSameCall = 1;
    }
    this.lastCallSignature = callSignature;

    // 检查 2: 速率限制
    const windowStart = now - this.config.rateWindowSec * 1000;
    const callsInWindow = this.recentCalls.filter((c) => c.timestamp >= windowStart).length;
    if (callsInWindow > this.config.maxCallsPerWindow) {
      this.totalTriggers++;
      log.warn('检测到工具调用速率过高', {
        callsInWindow,
        maxAllowed: this.config.maxCallsPerWindow,
        windowSec: this.config.rateWindowSec,
      });
      return {
        detected: true,
        type: 'rate-limit',
        reason: `${this.config.rateWindowSec}s 内工具调用 ${callsInWindow} 次，超过上限 ${this.config.maxCallsPerWindow}`,
        shouldBlock: true,
      };
    }

    return { detected: false, shouldBlock: false };
  }

  /**
   * 记录工具执行结果（成功或失败）。
   *
   * 在工具执行**后**调用。
   */
  recordResult(success: boolean): DoomLoopResult {
    if (!this.config.enabled) {
      return { detected: false, shouldBlock: false };
    }

    if (success) {
      this.consecutiveFailures = 0;
      return { detected: false, shouldBlock: false };
    }

    this.consecutiveFailures++;

    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      this.totalTriggers++;
      log.warn('检测到连续工具执行失败', {
        consecutiveFailures: this.consecutiveFailures,
        threshold: this.config.maxConsecutiveFailures,
      });
      return {
        detected: true,
        type: 'consecutive-failure',
        reason: `连续 ${this.consecutiveFailures} 次工具执行失败，建议暂停并检查问题`,
        shouldBlock: this.consecutiveFailures >= this.config.maxConsecutiveFailures + 3,
      };
    }

    return { detected: false, shouldBlock: false };
  }

  /**
   * 重置状态（例如用户确认继续后）
   */
  reset(): void {
    this.consecutiveFailures = 0;
    this.consecutiveSameCall = 0;
    this.lastCallSignature = null;
    this.recentCalls = [];
    this.totalTriggers = 0;
    log.debug('DoomLoopDetector 状态已重置');
  }

  /**
   * 获取当前统计信息
   */
  getStats(): {
    consecutiveFailures: number;
    consecutiveSameCall: number;
    recentCallCount: number;
    totalTriggers: number;
  } {
    this.pruneOldCalls(Date.now());
    return {
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSameCall: this.consecutiveSameCall,
      recentCallCount: this.recentCalls.length,
      totalTriggers: this.totalTriggers,
    };
  }

  /**
   * 更新配置（运行时热更新）
   */
  updateConfig(config: Partial<DoomLoopConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ============ 辅助方法 ============

  /**
   * 清理过期调用记录
   */
  private pruneOldCalls(now: number): void {
    const cutoff = now - Math.max(this.config.rateWindowSec * 2, 120) * 1000;
    this.recentCalls = this.recentCalls.filter((c) => c.timestamp >= cutoff);
  }

  /**
   * 参数签名：将参数转为稳定的字符串表示
   */
  private hashParams(params: Record<string, unknown>): string {
    try {
      // 排序键以确保一致性
      const sorted = Object.keys(params)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = params[key];
          return acc;
        }, {});
      return JSON.stringify(sorted);
    } catch {
      return String(params);
    }
  }
}

/**
 * 创建 DoomLoopDetector 实例的工厂函数
 */
export function createDoomLoopDetector(config?: Partial<DoomLoopConfig>): DoomLoopDetector {
  return new DoomLoopDetector(config);
}
