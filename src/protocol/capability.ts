/**
 * Agent 能力声明
 *
 * 每个 Agent 通过 Capability 声明自己能做什么类型的任务。
 * 调度器通过能力匹配将任务分发给合适的 Agent。
 */

/** 能力类别 */
export type CapabilityCategory =
  | 'code-generation' // 代码生成
  | 'code-modification' // 代码修改
  | 'code-analysis' // 代码分析
  | 'code-review' // 代码审查
  | 'security-scan' // 安全扫描
  | 'testing' // 测试相关
  | 'documentation' // 文档相关
  | 'research' // 信息搜集/研究
  | 'planning' // 规划/安排
  | 'data-analysis' // 数据分析
  | 'chat' // 对话/创意
  | 'generic'; // 通用

/** Agent 能力声明 */
export interface Capability {
  /** 能力唯一标识符 */
  id: string;
  /** 能力名称 */
  name: string;
  /** 能力描述 */
  description: string;
  /** 能力类别 */
  category: CapabilityCategory;
}

/** Agent 注册信息 */
export interface AgentRegistration {
  /** Agent 唯一标识 */
  agentId: string;
  /** Agent 显示名称 */
  displayName: string;
  /** Agent 声明的能力列表 */
  capabilities: Capability[];
  /** Agent 端点 URL（远程 Agent） */
  endpoint?: string;
  /** 当前状态 */
  status: AgentRegistrationStatus;
  /** 当前负载数 */
  currentLoad: number;
  /** 最大并发数 */
  maxConcurrency: number;
}

/** Agent 注册状态 */
export type AgentRegistrationStatus = 'online' | 'offline' | 'busy';
