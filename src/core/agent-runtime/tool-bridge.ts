/**
 * Tool Bridge — Capability → AgentTool 映射
 *
 * 将 zapmyco 的能力声明（Capability）转换为
 * pi-agent-core 可执行的工具定义（AgentTool）。
 *
 * @module core/agent-runtime/tool-bridge
 */

import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { Static, TSchema } from 'typebox';
import type { Capability } from '@/protocol/capability';

// ============ 类型定义 ============

/**
 * 工具执行函数签名
 *
 * 符合 pi-agent-core AgentTool.execute 的契约。
 */
export type ToolExecuteFn<TParameters extends TSchema = TSchema> = (
  toolCallId: string,
  params: Static<TParameters>,
  signal?: AbortSignal,
  onUpdate?: (partialResult: AgentToolResult<unknown>) => void
) => Promise<AgentToolResult<unknown>>;

/**
 * 工具注册信息
 *
 * 用于描述一个可被 Agent 调用的具体工具。
 */
export interface ToolRegistration {
  /** 工具唯一标识（对应 pi-ai Tool.name） */
  id: string;
  /** 显示名称（用于 UI 展示，对应 AgentTool.label） */
  label: string;
  /** 工具描述（帮助 LLM 理解何时调用此工具） */
  description: string;
  /** 参数 Schema（TypeBox 格式，用于参数校验和 LLM 理解） */
  parameters?: TSchema;
  /** 执行函数 */
  execute: ToolExecuteFn;
  /** 执行模式：顺序或并行 */
  executionMode?: 'sequential' | 'parallel';
}

// ============ 核心映射函数 ============

/**
 * 将单个 ToolRegistration 转换为 pi-agent-core 的 AgentTool
 *
 * @param registration - 工具注册信息
 * @returns pi-agent-core AgentTool 实例
 */
export function toAgentTool(registration: ToolRegistration): AgentTool {
  // AgentTool 要求 parameters 必须提供（TSchema 类型）
  // 当注册时未指定参数 schema，使用空对象 schema 作为默认
  const tool: AgentTool = {
    name: registration.id,
    description: registration.description,
    label: registration.label,
    parameters: registration.parameters ?? { type: 'object' as const, properties: {} },
    execute: registration.execute,
    ...(registration.executionMode != null ? { executionMode: registration.executionMode } : {}),
  };

  return tool;
}

/**
 * 将工具注册列表批量转换为 AgentTool 数组
 *
 * @param registrations - 工具注册列表
 * @returns AgentTool 数组
 */
export function toAgentTools(registrations: ToolRegistration[]): AgentTool[] {
  return registrations.map(toAgentTool);
}

/**
 * 基于 Capability 创建默认工具注册模板
 *
 * 此函数提供从 Capability 到 ToolRegistration 的基础映射。
 * 实际的 execute 函数需要由调用方根据具体能力注入。
 *
 * @param capability - 能力声明
 * @param execute - 执行函数（必须由调用方提供）
 * @returns ToolRegistration
 */
export function createToolFromCapability(
  capability: Capability,
  execute: ToolExecuteFn
): ToolRegistration {
  return {
    id: capability.id,
    label: capability.name,
    description: capability.description,
    execute,
  };
}

/**
 * 基于多个 Capability 批量创建工具注册模板
 *
 * @param capabilities - 能力声明列表
 * @param executorFactory - 根据 Capability 生成执行函数的工厂
 * @returns ToolRegistration 数组
 */
export function createToolsFromCapabilities(
  capabilities: Capability[],
  executorFactory: (capability: Capability) => ToolExecuteFn
): ToolRegistration[] {
  return capabilities.map((cap) => createToolFromCapability(cap, executorFactory(cap)));
}
