import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTaskStopTool } from '@/cli/repl/tools/task-stop';
import {
  getAgentInstanceManager,
  resetAgentInstanceManager,
} from '@/core/agent-team/agent-instance-manager';
import type { AgentTypeDefinition } from '@/core/agent-team/types';

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
    prompt: vi.fn(),
    waitForIdle: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
    reset: vi.fn(),
  })),
}));

function createMockDef(typeId: string): AgentTypeDefinition {
  return {
    typeId,
    displayName: typeId,
    whenToUse: 'test',
    role: 'worker',
    capabilities: [],
    toolPolicy: { mode: 'safe' },
    permissionMode: 'restricted',
    source: 'builtin',
    maxTurns: 30,
    maxSpawnDepth: 0,
    getSystemPrompt: () => `System prompt for ${typeId}`,
  };
}

function registerAgent(
  id: string,
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused' = 'running'
) {
  const instanceManager = getAgentInstanceManager();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instance = instanceManager.register(
    createMockDef('worker'),
    { agentId: id, cancel: vi.fn().mockResolvedValue(undefined) } as any,
    {
      taskId: `task-${id}`,
      description: 'test',
      mode: 'sync',
      timeoutMs: 10000,
      inheritContext: false,
    },
    null,
    0
  );
  // Transition to desired status through valid state chain
  if (status !== 'idle') {
    // Must go through 'running' first for non-idle, non-cancelled states
    if (instance.status !== 'running') {
      instanceManager.transition(id, 'running');
    }
    if (status !== 'running') {
      instanceManager.transition(id, status);
    }
  }
  return instance;
}

describe('createTaskStopTool', () => {
  beforeEach(() => {
    resetAgentInstanceManager();
  });

  describe('tool registration', () => {
    it('should create tool with correct id', () => {
      const tool = createTaskStopTool();
      expect(tool.id).toBe('TaskStop');
      expect(tool.label).toBe('停止任务');
      expect(tool.defaultRisk).toBe('medium');
    });

    it('should require task_id parameter', () => {
      const tool = createTaskStopTool();
      const params = tool.parameters as { required: string[] };
      expect(params.required).toContain('task_id');
    });
  });

  describe('execute - error cases', () => {
    it('should return not found when task_id does not exist', async () => {
      const tool = createTaskStopTool();
      const result = await tool.execute('call-1', { task_id: 'non-existent' });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result.content?.[0] as any)?.text).toContain('未找到任务');
      expect(result.details).toEqual({
        taskId: 'non-existent',
        found: false,
      });
    });

    it('should return error when task is in terminal state (completed)', async () => {
      registerAgent('agent-completed', 'completed');
      const tool = createTaskStopTool();
      const result = await tool.execute('call-1', { task_id: 'agent-completed' });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result.content?.[0] as any)?.text).toContain('无法停止');
      expect(result.details).toEqual({
        taskId: 'agent-completed',
        status: 'completed',
        stopped: false,
      });
    });

    it('should return error when task is already cancelled', async () => {
      registerAgent('agent-cancelled', 'cancelled');
      const tool = createTaskStopTool();
      const result = await tool.execute('call-1', { task_id: 'agent-cancelled' });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result.content?.[0] as any)?.text).toContain('无法停止');
      expect(result.details).toEqual({
        taskId: 'agent-cancelled',
        status: 'cancelled',
        stopped: false,
      });
    });

    it('should return error when task has failed', async () => {
      registerAgent('agent-failed', 'failed');
      const tool = createTaskStopTool();
      const result = await tool.execute('call-1', { task_id: 'agent-failed' });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result.content?.[0] as any)?.text).toContain('无法停止');
      expect(result.details).toEqual({
        taskId: 'agent-failed',
        status: 'failed',
        stopped: false,
      });
    });
  });

  describe('execute - success cases', () => {
    it('should stop a running agent', async () => {
      const instance = registerAgent('agent-running', 'running');
      const cancelSpy = vi.spyOn(instance.agent, 'cancel');

      const tool = createTaskStopTool();
      const result = await tool.execute('call-1', { task_id: 'agent-running' });

      expect(cancelSpy).toHaveBeenCalledWith('task-agent-running');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result.content?.[0] as any)?.text).toContain('已停止');
      expect(result.details).toEqual({
        taskId: 'agent-running',
        stopped: true,
        cancelled: 1,
      });
    });

    it('should stop an idle agent', async () => {
      const instance = registerAgent('agent-idle', 'idle');
      const cancelSpy = vi.spyOn(instance.agent, 'cancel');

      const tool = createTaskStopTool();
      const result = await tool.execute('call-1', { task_id: 'agent-idle' });

      expect(cancelSpy).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result.content?.[0] as any)?.text).toContain('已停止');
    });

    it('should return cancelled count via AgentInstanceManager.cancel', async () => {
      registerAgent('agent-parent', 'running');
      // Simulating cancel that returns multiple cancelled IDs
      const instanceManager = getAgentInstanceManager();
      vi.spyOn(instanceManager, 'cancel').mockResolvedValueOnce([
        'agent-parent',
        'child-1',
        'child-2',
      ]);

      const tool = createTaskStopTool();
      const result = await tool.execute('call-1', { task_id: 'agent-parent' });

      expect(result.details).toEqual({
        taskId: 'agent-parent',
        stopped: true,
        cancelled: 3,
      });
    });
  });
});
