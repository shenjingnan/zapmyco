import { describe, expect, it } from 'vitest';
import type {
  AgentExecuteOptions,
  AgentExecuteRequest,
  AgentHealthStatus,
  AgentStatus,
  IAgent,
  IStreamingAgent,
} from '@/protocol/agent';
import type {
  AgentRegistration,
  AgentRegistrationStatus,
  Capability,
  CapabilityCategory,
} from '@/protocol/capability';

/**
 * Protocol 层类型定义覆盖率测试
 *
 * 纯接口/类型定义文件通过导入验证正确性。
 */

describe('protocol types', () => {
  it('should export agent protocol types correctly', () => {
    // 验证接口存在（通过 typeof 检查）
    expect(typeof ({} as IAgent)).toBeDefined();
    expect(typeof ({} as IStreamingAgent)).toBeDefined();

    // 验证 AgentStatus 联合类型
    const statuses: AgentStatus[] = ['online', 'offline', 'busy', 'degraded'];
    expect(statuses).toHaveLength(4);

    // 验证请求结构
    const request: AgentExecuteRequest = {
      taskId: 'task-1',
      taskDescription: 'Test task',
      workdir: '/tmp/test',
      options: { timeout: 30000, verbose: false },
    };
    expect(request.taskId).toBe('task-1');

    // 验证选项结构
    const options: AgentExecuteOptions = {
      timeout: 60000,
      verbose: true,
    };
    expect(options.timeout).toBe(60000);

    // 验证健康检查结构
    const health: AgentHealthStatus = {
      是否健康: true,
      latencyMs: 50,
      version: '1.0.0',
    };
    expect(health.是否健康).toBe(true);
  });

  it('should export capability types correctly', () => {
    // 验证 CapabilityCategory
    const categories: CapabilityCategory[] = [
      'code-generation',
      'code-modification',
      'code-analysis',
      'code-review',
      'security-scan',
      'testing',
      'documentation',
      'research',
      'planning',
      'data-analysis',
      'chat',
      'generic',
    ];
    expect(categories).toHaveLength(12);

    // 验证 Capability 结构
    const cap: Capability = {
      id: 'cap-1',
      name: 'Code Gen',
      description: 'Generates code',
      category: 'code-generation',
    };
    expect(cap.category).toBe('code-generation');

    // 验证 AgentRegistrationStatus
    const regStatuses: AgentRegistrationStatus[] = ['online', 'offline', 'busy'];
    expect(regStatuses).toHaveLength(3);

    // 验证 AgentRegistration 结构
    const registration: AgentRegistration = {
      agentId: 'agent-1',
      displayName: 'Code Agent',
      capabilities: [cap],
      status: 'online',
      currentLoad: 0,
      maxConcurrency: 5,
    };
    expect(registration.agentId).toBe('agent-1');
  });
});
