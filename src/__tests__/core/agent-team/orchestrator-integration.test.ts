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
import { coderType } from '@/core/agent-team/builtin-types/coder';
import { generalPurposeType } from '@/core/agent-team/builtin-types/general-purpose';
import { researcherType } from '@/core/agent-team/builtin-types/researcher';
import type { AgentTeamConfig } from '@/core/agent-team/types';

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
  maxConcurrent: 3,
  taskTimeoutMs: 30000,
  maxOutputChars: 2000,
  maxTurns: 10,
  allowRecursiveSpawn: false,
};

describe('AgentOrchestrator Integration', () => {
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    resetAgentTypeRegistry();
    resetAgentInstanceManager();
    const registry = getAgentTypeRegistry();
    registry.register(generalPurposeType);
    registry.register(researcherType);
    registry.register(coderType);

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
      { id: 'Grep', label: 'Grep', description: 'Grep', execute: async () => ({ content: [] }) },
      {
        id: 'WebFetch',
        label: 'Fetch',
        description: 'Fetch',
        execute: async () => ({ content: [] }),
      },
      {
        id: 'WebSearch',
        label: 'Search',
        description: 'Search',
        execute: async () => ({ content: [] }),
      },
      {
        id: 'WriteFile',
        label: 'Write',
        description: 'Write',
        execute: async () => ({ content: [] }),
      },
      {
        id: 'EditFile',
        label: 'Edit',
        description: 'Edit',
        execute: async () => ({ content: [] }),
      },
    ] as any;

    orchestrator = new AgentOrchestrator(teamConfig, flatConfig, parentAgent, mockTools);
  });

  describe('spawnTeam with multiple agent types', () => {
    it('should spawn researcher and coder workers', async () => {
      const result = await orchestrator.spawnTeam('analyze and implement', [
        { typeId: 'researcher', taskDescription: 'research the topic' },
        { typeId: 'coder', taskDescription: 'implement the solution' },
      ]);

      expect(result.workerResults).toHaveLength(2);
      expect(result.workerResults[0]?.typeId).toBe('researcher');
      expect(result.workerResults[1]?.typeId).toBe('coder');
      expect(result.stats.total).toBe(2);
    });

    it('should generate readable summary', async () => {
      const result = await orchestrator.spawnTeam('test', [
        { typeId: 'general-purpose', taskDescription: 'task A' },
      ]);

      expect(result.summary).toContain('Team 执行汇总');
      expect(result.summary).toContain('general-purpose');
      expect(result.summary).toContain('task A');
    });
  });

  describe('instance lifecycle', () => {
    it('should register workers in instance manager', async () => {
      const instanceManager = getAgentInstanceManager();

      await orchestrator.spawnWorker('researcher', 'research task');

      const instances = instanceManager.listAll();
      expect(instances.length).toBeGreaterThan(0);
      const workerInstance = instances.find((i) => i.typeId === 'researcher');
      expect(workerInstance).toBeDefined();
      expect(workerInstance?.task.description).toBe('research task');
    });

    it('should transition worker state', async () => {
      const instanceManager = getAgentInstanceManager();

      await orchestrator.spawnWorker('general-purpose', 'simple task');

      const instances = instanceManager.listAll();
      const workerInstance = instances.find((i) => i.typeId === 'general-purpose');
      expect(workerInstance).toBeDefined();
      expect(['completed', 'failed']).toContain(workerInstance?.status);
    });
  });

  describe('depth tracking', () => {
    it('should set correct depth for spawned workers', async () => {
      const instanceManager = getAgentInstanceManager();

      await orchestrator.spawnWorker('general-purpose', 'depth 1 task');

      const instances = instanceManager.listAll();
      const workerInstance = instances.find((i) => i.typeId === 'general-purpose');
      expect(workerInstance?.depth).toBe(1);
    });

    it('should set parent-child relationship', async () => {
      const instanceManager = getAgentInstanceManager();

      // Register parent first
      const parentId = 'my-parent';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parentAgent = {
        agentId: parentId,
        innerAgent: { state: { model: { provider: 'test', model: 'test-model' } } },
        llmFacade: undefined,
        systemPromptOverride: null,
      } as any;

      instanceManager.register(
        generalPurposeType,
        parentAgent,
        {
          taskId: 'p1',
          description: 'parent',
          mode: 'sync',
          timeoutMs: 10000,
          inheritContext: false,
        },
        null,
        0
      );

      await orchestrator.spawnWorker('general-purpose', 'child task', {
        parentInstanceId: parentId,
      });

      const parent = instanceManager.get(parentId);
      expect(parent).toBeDefined();
      expect(parent?.childInstanceIds.length).toBeGreaterThan(0);
    });
  });

  describe('type-specific tool policies', () => {
    it('should create researcher with safe tool policy', () => {
      const registry = getAgentTypeRegistry();
      const type = registry.get('researcher');
      expect(type).toBeDefined();
      expect(type?.toolPolicy.mode).toBe('safe');
      expect(type?.role).toBe('worker');
      expect(type?.maxSpawnDepth).toBe(0);
    });

    it('should create coder with standard tool policy', () => {
      const registry = getAgentTypeRegistry();
      const type = registry.get('coder');
      expect(type).toBeDefined();
      expect(type?.toolPolicy.mode).toBe('standard');
      expect(type?.role).toBe('worker');
      expect(type?.maxSpawnDepth).toBe(0);
    });
  });
});
