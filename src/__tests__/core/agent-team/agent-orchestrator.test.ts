import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubAgentConfig } from '@/config/types';
import { resetAgentInstanceManager } from '@/core/agent-team/agent-instance-manager';
import { AgentOrchestrator } from '@/core/agent-team/agent-orchestrator';
import {
  getAgentTypeRegistry,
  resetAgentTypeRegistry,
} from '@/core/agent-team/agent-type-registry';
import { generalPurposeType } from '@/core/agent-team/builtin-types/general-purpose';
import type { AgentTeamConfig } from '@/core/agent-team/types';
import type { SubAgentSpec } from '@/core/sub-agent/types';

// Mock pi-agent-core
vi.mock('@mariozechner/pi-agent-core', () => ({
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
  });

  function createOrchestrator(overrides?: Partial<AgentTeamConfig>) {
    const config = { ...teamConfig, ...overrides };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parentAgent = {
      agentId: 'parent',
      innerAgent: { state: { model: { provider: 'test', model: 'test-model' } } },
      llmFacade: undefined,
      systemPromptOverride: null,
    } as any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mockTools = [
      {
        id: 'ReadFile',
        label: 'Read',
        description: 'Read',
        execute: async () => ({ content: [] }),
      },
      { id: 'Glob', label: 'Glob', description: 'Glob', execute: async () => ({ content: [] }) },
    ] as any;

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
});
