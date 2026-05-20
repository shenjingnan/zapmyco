/**
 * LLM 提供商类型定义
 *
 * ResolvedModel 替代 pi-ai 的 Model 类型，只携带 LLM 调用实际需要的字段。
 * 与 ModelInfo（用于注册/发现）互补：ModelInfo 用于配置和路由，ResolvedModel 用于实际调用。
 *
 * @module llm/provider-types
 */

/**
 * 已解析的模型信息，可直接用于 LLM API 调用
 */
export interface ResolvedModel {
  /** 模型 ID（API 实际值），如 "claude-sonnet-4-20250514" */
  id: string;
  /** 提供商名称，如 "anthropic"、"deepseek" */
  provider: string;
  /** 自定义 base URL，不传时使用 SDK 默认值 */
  baseURL?: string;
  /** 已解析的 API Key */
  apiKey?: string;
}
