/**
 * zapmyco 默认配置
 *
 * 当用户未提供配置时，使用这些默认值。
 */

import type { ZapmycoConfig } from '@/config/types';

/** 默认配置 */
export const DEFAULT_CONFIG: ZapmycoConfig = {
  llm: {
    provider: 'anthropic',
    // API Key 通过环境变量 ANTHROPIC_API_KEY 设置
    // model: undefined 表示使用提供商默认模型
  } as import('@/config/types').LlmProviderConfig,
  scheduler: {
    maxConcurrency: 5,
    maxPerAgent: 3,
    taskTimeoutMs: 30 * 60 * 1000, // 30 分钟
    maxRetries: 3,
    retryBaseDelayMs: 1000,
  },
  agents: [
    { id: 'code-agent', enabled: true },
    { id: 'security-scanner', enabled: true },
    { id: 'research-agent', enabled: true },
    { id: 'planning-agent', enabled: true },
  ],
  cli: {
    color: true,
    debug: false,
    outputFormat: 'text',
  },
};
