/**
 * Agent 消息总线
 *
 * 内存中的 Agent 间消息路由系统。
 * 基于 EventEmitter 实现 publish/subscribe 模式，
 * 消息同时投递到目标 AgentInstance 的 inbox。
 *
 * @module core/agent-team
 */

import { EventEmitter } from 'node:events';
import type { AgentMessage } from '@/core/agent-team/types';
import { logger } from '@/infra/logger';
import { getAgentInstanceManager } from './agent-instance-manager';

const log = logger.child('agent-message-bus');

/** 消息到达回调 */
export type MessageCallback = (message: AgentMessage) => void;

/**
 * Agent 消息总线（单例）
 *
 * 负责 Agent 间消息的路由和投递：
 * - publish(): 将消息投递到目标 inbox + 触发订阅回调
 * - subscribe(): 注册消息监听器
 * - drainInbox(): 取出并清空 Agent 收件箱
 */
export class AgentMessageBus {
  private emitter = new EventEmitter();
  private messageCounter = 0;

  /**
   * 发布消息
   *
   * 1. 生成 messageId（若未提供）
   * 2. 将消息推入目标 AgentInstance.inbox（通过 AgentInstanceManager）
   * 3. 触发目标 Agent 的订阅回调
   *
   * @param fromAgentId - 发送方实例 ID
   * @param toAgentId - 接收方实例 ID
   * @param message - 消息内容（不含 messageId/fromAgentId/timestamp）
   * @returns 完整的 AgentMessage（含生成的 messageId 和 timestamp）
   */
  publish(
    fromAgentId: string,
    toAgentId: string,
    message: Omit<AgentMessage, 'messageId' | 'fromAgentId' | 'toAgentId' | 'timestamp'>
  ): AgentMessage {
    const fullMessage: AgentMessage = {
      ...message,
      messageId: this.generateMessageId(),
      fromAgentId,
      toAgentId,
      timestamp: Date.now(),
    };

    // 投递到目标 Agent 的 inbox
    const instanceManager = getAgentInstanceManager();
    const targetInstance = instanceManager.get(toAgentId);

    if (targetInstance) {
      targetInstance.inbox.push(fullMessage);
    } else {
      log.warn('目标 Agent 实例不存在，消息丢弃', {
        toAgentId,
        messageId: fullMessage.messageId,
      });
    }

    // 触发订阅回调
    this.emitter.emit(`msg:${toAgentId}`, fullMessage);

    log.debug('消息已投递', {
      from: fromAgentId,
      to: toAgentId,
      type: fullMessage.type,
      messageId: fullMessage.messageId,
    });

    return fullMessage;
  }

  /**
   * 订阅指定 Agent 的消息
   *
   * 当有新消息投递到该 Agent 时，回调被触发。
   *
   * @param agentId - 要监听的 Agent 实例 ID
   * @param callback - 消息到达时的回调
   */
  subscribe(agentId: string, callback: MessageCallback): void {
    this.emitter.on(`msg:${agentId}`, callback);
  }

  /**
   * 取消订阅
   *
   * @param agentId - Agent 实例 ID
   * @param callback - 要移除的回调
   */
  unsubscribe(agentId: string, callback: MessageCallback): void {
    this.emitter.off(`msg:${agentId}`, callback);
  }

  /**
   * 取出并清空指定 Agent 的收件箱
   *
   * @param agentId - Agent 实例 ID
   * @returns 收件箱中的所有消息（按投递时间排序）
   */
  drainInbox(agentId: string): AgentMessage[] {
    const instanceManager = getAgentInstanceManager();
    const instance = instanceManager.get(agentId);

    if (!instance || instance.inbox.length === 0) {
      return [];
    }

    const messages = [...instance.inbox];
    instance.inbox = [];
    return messages;
  }

  /**
   * 获取收件箱中的消息数量（不清空）
   *
   * @param agentId - Agent 实例 ID
   */
  inboxCount(agentId: string): number {
    const instanceManager = getAgentInstanceManager();
    const instance = instanceManager.get(agentId);
    return instance?.inbox.length ?? 0;
  }

  /** 获取当前活跃的订阅数量 */
  get subscriptionCount(): number {
    return this.emitter.listenerCount('msg:');
  }

  /** 生成唯一消息 ID */
  private generateMessageId(): string {
    this.messageCounter++;
    return `msg-${Date.now()}-${this.messageCounter}`;
  }
}

/** 全局单例引用 */
let _messageBus: AgentMessageBus | null = null;

/**
 * 获取 AgentMessageBus 单例
 */
export function getAgentMessageBus(): AgentMessageBus {
  if (!_messageBus) {
    _messageBus = new AgentMessageBus();
  }
  return _messageBus;
}

/**
 * 重置 AgentMessageBus 单例（仅供测试使用）
 */
export function resetAgentMessageBus(): void {
  _messageBus = null;
}
