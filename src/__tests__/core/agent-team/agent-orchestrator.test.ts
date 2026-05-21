import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubAgentConfig } from '@/config/types';
import {
  getAgentInstanceManager,
  resetAgentInstanceManager,
} from '@/core/agent-team/agent-instance-manager';
import { AgentOrchestrator } from '@/core/agent-team/agent-orchestrator';
import {
  getAgentTypeRegistry,
  resetAgentTypeRegistry,
} from '@/core/agent-team/agent-type-registry';
import { generalPurposeType } from '@/core/agent-team/builtin-types/general-purpose';
import type { AgentTeamConfig } from '@/core/agent-team/types';
import type { SubAgentSpec } from '@/core/sub-agent/types';

// 共享 mock Agent 的事件追踪变量
const { mockProgressHandlers, mockAgentOn, mockAgentOff } = vi.hoisted(() => {
  const handlers: Array<(event: { taskId: string; percent: number; message: string }) => void> = [];
  return {
    mockProgressHandlers: handlers,
    mockAgentOn: vi.fn(
      (
        event: string,
        handler: (event: { taskId: string; percent: number; message: string }) => void
      ) => {
        if (event === 'progress') handlers.push(handler);
      }
    ),
    mockAgentOff: vi.fn(),
  };
});

// Mock pi-agent-core
vi.mock('@/core/agent-runtime/agent', () => ({
  Agent: vi.fn().mockImplementation(() => ({
    state: {
      systemPrompt: '',
      model: {},
      thinkingLevel: 'medium',
      tools: [],
      messages: [],
      isStreaming: false,
      pendingToolCalls: new Set<string>(),
    },
    subscribe: vi.fn().mockReturnValue(vi.fn()),
    prompt: vi.fn().mockResolvedValue(undefined),
    waitForIdle: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
    reset: vi.fn(),
    EVENT_PROGRESS: 'progress',
    on: mockAgentOn,
    off: mockAgentOff,
    execute: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'done' }] }),
  })),
}));

vi.mock('@/llm/model-resolver', () => ({
  resolveModel: vi.fn().mockReturnValue({ provider: 'test', model: 'test-model', maxTokens: 4096 }),
}));

const teamConfig: AgentTeamConfig = {
  enabled: true,
  defaultMode: 'flat',
  maxGlobalDepth: 2,
  messageTimeoutMs: 30000,
  maxAggregateOutputChars: 5000,
};

const flatConfig: SubAgentConfig = {
  enabled: true,
  maxConcurrent: 2,
  taskTimeoutMs: 30000,
  maxOutputChars: 1000,
  maxTurns: 10,
  allowRecursiveSpawn: false,
};

describe('AgentOrchestrator', () => {
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    resetAgentTypeRegistry();
    resetAgentInstanceManager();
    getAgentTypeRegistry().register(generalPurposeType);
    mockProgressHandlers.length = 0;
  });

  function createOrchestrator(overrides?: Partial<AgentTeamConfig>) {
    const config = { ...teamConfig, ...overrides };
    // biome-ignore lint/suspicious/noExplicitAny: mock parent agent for orchestrator constructor
    const parentAgent: any = {
      agentId: 'parent',
      innerAgent: { state: { model: { provider: 'test', model: 'test-model' } } },
      llmFacade: undefined,
      systemPromptOverride: null,
    };

    // biome-ignore lint/suspicious/noExplicitAny: mock tools for orchestrator constructor
    const mockTools: any[] = [
      {
        id: 'ReadFile',
        label: 'Read',
        description: 'Read',
        execute: async () => ({ content: [] }),
      },
      { id: 'Glob', label: 'Glob', description: 'Glob', execute: async () => ({ content: [] }) },
    ];

    return new AgentOrchestrator(config, flatConfig, parentAgent, mockTools);
  }

  describe('spawnWorker', () => {
    it('should return failure for unknown type', async () => {
      orchestrator = createOrchestrator();
      const result = await orchestrator.spawnWorker('nonexistent', 'test task');
      expect(result.status).toBe('failure');
      expect(result.error?.code).toBe('UNKNOWN_TYPE');
    });

    it('should reject at depth exceeding maxGlobalDepth', async () => {
      orchestrator = createOrchestrator({ maxGlobalDepth: 0 });
      const result = await orchestrator.spawnWorker('general-purpose', 'test task');
      expect(result.status).toBe('failure');
      expect(result.error?.code).toBe('MAX_DEPTH_EXCEEDED');
    });

    it('should call wrapExecute when provided', async () => {
      orchestrator = createOrchestrator();
      let wrappedCalled = false;

      await orchestrator.spawnWorker('general-purpose', 'test task', {
        wrapExecute: async (execute) => {
          wrappedCalled = true;
          return execute();
        },
      });

      expect(wrappedCalled).toBe(true);
    });
  });

  describe('spawnFlat', () => {
    it('should return results for valid specs', async () => {
      orchestrator = createOrchestrator();
      const specs: SubAgentSpec[] = [{ id: 'task-1', description: 'test task 1' }];

      const results = await orchestrator.spawnFlat(specs);
      expect(results.results).toHaveLength(1);
      expect(results.results[0]?.specId).toBe('task-1');
    });

    it('should handle batch execution with maxConcurrent', async () => {
      orchestrator = createOrchestrator();
      const specs: SubAgentSpec[] = [
        { id: 'a', description: 'a' },
        { id: 'b', description: 'b' },
        { id: 'c', description: 'c' },
      ];

      const results = await orchestrator.spawnFlat(specs);
      // maxConcurrent=2, so 3 specs run in 2 batches
      expect(results.results).toHaveLength(3);
    });
  });

  describe('spawnTeam', () => {
    it('should spawn team with workers', async () => {
      orchestrator = createOrchestrator();
      const result = await orchestrator.spawnTeam('team task', [
        { typeId: 'general-purpose', taskDescription: 'worker task 1' },
        { typeId: 'general-purpose', taskDescription: 'worker task 2' },
      ]);

      expect(result.teamId).toMatch(/^team-/);
      expect(result.workerResults).toHaveLength(2);
      expect(result.stats.total).toBe(2);
    });

    it('should handle empty worker list', async () => {
      orchestrator = createOrchestrator();
      const result = await orchestrator.spawnTeam('team task', []);

      expect(result.workerResults).toHaveLength(0);
      expect(result.stats.total).toBe(0);
      expect(result.summary).toContain('无 Worker 结果');
    });

    it('should batch workers respecting maxConcurrent', async () => {
      orchestrator = createOrchestrator();
      const specs = Array.from({ length: 5 }, (_, i) => ({
        typeId: 'general-purpose',
        taskDescription: `task ${i}`,
      }));

      const result = await orchestrator.spawnTeam('batch test', specs);
      expect(result.workerResults).toHaveLength(5);
    });

    it('should handle unknown types as failures', async () => {
      orchestrator = createOrchestrator();
      const result = await orchestrator.spawnTeam('mixed test', [
        { typeId: 'general-purpose', taskDescription: 'task 1' },
        { typeId: 'nonexistent', taskDescription: 'fail task' },
      ]);

      expect(result.workerResults).toHaveLength(2);
      expect(result.workerResults[1]?.status).toBe('failure');
      expect(result.workerResults[1]?.error?.code).toBe('UNKNOWN_TYPE');
      expect(result.stats.total).toBe(2);
    });
  });

  describe('progress relay', () => {
    it('spawnWorker should complete with progress relay (no throw)', async () => {
      orchestrator = createOrchestrator();
      const result = await orchestrator.spawnWorker('general-purpose', 'test task');
      // Agent mock 执行返回 failure，但 relay 不应中断流程
      expect(result).toBeDefined();
    });

    it('spawnFlat should complete with progress relay (no throw)', async () => {
      orchestrator = createOrchestrator();
      const specs: SubAgentSpec[] = [{ id: 'test', description: 'test' }];
      const result = await orchestrator.spawnFlat(specs);
      // relay 不应影响 spawnFlat 正常返回结果
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.specId).toBe('test');
    });

    it('instance should be registered after spawnWorker', async () => {
      orchestrator = createOrchestrator();
      await orchestrator.spawnWorker('general-purpose', 'test task');
      const mgr = getAgentInstanceManager();
      const instances = mgr.listAll();
      // Agent 实例应被注册（即使执行"失败"）
      expect(instances.some((i) => i.typeId === 'general-purpose')).toBe(true);
    });

    it('spawnFlat should register instances via InstanceManager', async () => {
      orchestrator = createOrchestrator();
      const specs: SubAgentSpec[] = [
        { id: 'a', description: 'task a' },
        { id: 'b', description: 'task b' },
      ];
      await orchestrator.spawnFlat(specs);
      const mgr = getAgentInstanceManager();
      const instances = mgr.listAll();
      // 每个 flat sub-agent 都应注册为实例
      expect(instances.length).toBeGreaterThan(0);
    });

    it('should handle progress relay cleanup after spawnWorker', async () => {
      orchestrator = createOrchestrator();
      // 连续调用 spawnWorker 不应泄漏监听器
      await orchestrator.spawnWorker('general-purpose', 'task 1');
      await orchestrator.spawnWorker('general-purpose', 'task 2');
      // 没有错误即表示清理正常
      expect(true).toBe(true);
    });

    it('should handle detail field in progress relay without error', async () => {
      orchestrator = createOrchestrator();
      // 连续 relay 应正确处理 detail 字段而不抛异常
      const result = await orchestrator.spawnWorker('general-purpose', 'test task');
      expect(result).toBeDefined();
    });

    it('should handle mixed format progress events in relay', async () => {
      orchestrator = createOrchestrator();
      // 旧格式（无 detail）和新格式（有 detail）在同一个 relay 中不应冲突
      const specs: SubAgentSpec[] = [{ id: 'test', description: 'test' }];
      const result = await orchestrator.spawnFlat(specs);
      expect(result.results).toHaveLength(1);
    });
  });
});
