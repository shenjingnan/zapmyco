/**
 * zapmyco 默认配置
 *
 * 当用户未提供配置时，使用这些默认值。
 */

import type { ZapmycoConfig } from '@/config/types';

/** 默认配置 */
export const DEFAULT_CONFIG: ZapmycoConfig = {
  llm: {
    defaultModel: 'anthropic/claude-sonnet-4-20250514',
    models: {
      'anthropic/claude-sonnet-4-20250514': {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-20250514',
        description: 'Anthropic Claude Sonnet 4 - 均衡模型，日常使用推荐',
      },
    },
    providers: {
      anthropic: {
        // biome-ignore lint/suspicious/noTemplateCurlyInString: 环境变量引用语法
        apiKey: '${ANTHROPIC_API_KEY}',
      },
    },
    defaults: {
      maxTokens: 8192,
      temperature: 0.7,
    },
  },
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
