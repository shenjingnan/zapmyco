import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentTool } from '@/cli/repl/tools/agent-tool';
import type { SubAgentConfig } from '@/config/types';
import type { LlmBasedAgent } from '@/core/agent-runtime';
import type { TextContent } from '@/core/agent-runtime/runtime-types';
import type { ToolRegistration } from '@/core/agent-runtime/tool-bridge';
import {
  getBackgroundAgentManager,
  resetBackgroundAgentManager,
} from '@/core/agent-team/agent-background-manager';
import { resetAgentInstanceManager } from '@/core/agent-team/agent-instance-manager';
import { AgentOrchestrator } from '@/core/agent-team/agent-orchestrator';
import {
  getAgentTypeRegistry,
  resetAgentTypeRegistry,
} from '@/core/agent-team/agent-type-registry';
import { generalPurposeType } from '@/core/agent-team/builtin-types/general-purpose';
import type { AgentTeamConfig, WorkerResult } from '@/core/agent-team/types';

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

describe('createAgentTool', () => {
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    resetAgentTypeRegistry();
    resetAgentInstanceManager();
    resetBackgroundAgentManager();
    getAgentTypeRegistry().register(generalPurposeType);

    const parentAgent = {
      agentId: 'parent',
      innerAgent: { state: { model: { provider: 'test', model: 'test-model' } } },
      llmFacade: undefined,
      systemPromptOverride: null,
    } as unknown as LlmBasedAgent;

    const mockTools = [
      {
        id: 'ReadFile',
        label: 'Read',
        description: 'Read',
        execute: async () => ({ content: [] }),
      },
    ] as unknown as ToolRegistration[];

    orchestrator = new AgentOrchestrator(teamConfig, flatConfig, parentAgent, mockTools);
    getBackgroundAgentManager().setOrchestrator(orchestrator);
  });

  describe('tool registration', () => {
    it('should create tool with correct id', () => {
      const tool = createAgentTool(orchestrator);
      expect(tool.id).toBe('AgentTool');
      expect(tool.label).toBe('创建 Agent');
      expect(tool.defaultRisk).toBe('high');
    });

    it('should include available agent types in description', () => {
      const tool = createAgentTool(orchestrator);
      expect(tool.description).toContain('general-purpose');
      expect(tool.description).toContain('subagent_type');
    });

    it('should include parameters schema with subagent_type', () => {
      const tool = createAgentTool(orchestrator);
      const params = tool.parameters as { properties: Record<string, unknown> };
      expect(params.properties).toHaveProperty('subagent_type');
      expect(params.properties).toHaveProperty('description');
      expect(params.properties).toHaveProperty('agents');
    });
  });

  describe('execute', () => {
    it('should launch background agent when run_in_background is true', async () => {
      const tool = createAgentTool(orchestrator);
      const result = await tool.execute('call-1', {
        subagent_type: 'general-purpose',
        description: 'test',
        run_in_background: true,
      });
      expect((result.content?.[0] as TextContent)?.text).toContain('已作为后台任务启动');
      const details = result.details as { taskId: string; instanceId: string; status: string };
      expect(details.status).toBe('async_launched');
      expect(details.taskId).toBeDefined();
    });

    it('should return error when run_in_background is true but no subagent_type', async () => {
      const tool = createAgentTool(orchestrator);
      const result = await tool.execute('call-1', {
        description: 'test',
        run_in_background: true,
      });
      expect((result.content?.[0] as TextContent)?.text).toContain('需要指定 subagent_type');
    });

    it('should spawn worker via subagent_type', async () => {
      const tool = createAgentTool(orchestrator);
      const result = await tool.execute('call-1', {
        subagent_type: 'general-purpose',
        description: 'research topic',
      });
      expect((result.content?.[0] as TextContent)?.text).toBeDefined();
    });

    it('should fallback to flat spawn with agents parameter', async () => {
      const tool = createAgentTool(orchestrator);
      const result = await tool.execute('call-1', {
        description: 'parent task',
        agents: [
          { id: 'a1', description: 'task 1' },
          { id: 'a2', description: 'task 2' },
        ],
      });
      expect((result.content?.[0] as TextContent)?.text).toBeDefined();
      expect(result.details).toBeDefined();
    });

    it('should return guidance when no subagent_type or agents provided', async () => {
      const tool = createAgentTool(orchestrator);
      const result = await tool.execute('call-1', {
        description: 'test',
      });
      expect((result.content?.[0] as TextContent)?.text).toContain('请指定 subagent_type');
    });

    it('should return error for unknown type', async () => {
      const tool = createAgentTool(orchestrator);
      const result = await tool.execute('call-2', {
        subagent_type: 'nonexistent',
        description: 'test',
      });
      expect((result.content?.[0] as TextContent)?.text).toContain('执行失败');
    });

    it('should show success message for successful spawn', async () => {
      // Mock spawnWorker to return success
      vi.spyOn(orchestrator, 'spawnWorker').mockResolvedValueOnce({
        status: 'success',
        typeId: 'general-purpose',
        output: 'Task completed successfully',
        duration: 1500,
        tokenUsage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          estimatedCostUsd: 0,
        },
        taskId: 'task-1',
        instanceId: 'inst-1',
        subtaskResults: undefined,
      } as unknown as WorkerResult);

      const tool = createAgentTool(orchestrator);
      const result = await tool.execute('call-1', {
        subagent_type: 'general-purpose',
        description: 'test task',
      });
      const text = (result.content?.[0] as TextContent)?.text;
      expect(text).toContain('执行成功');
      expect(text).toContain('general-purpose');
      expect(text).toContain('Task completed successfully');
    });
  });
});
