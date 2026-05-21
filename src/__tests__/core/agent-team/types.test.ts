import { describe, expect, it } from 'vitest';
import type {
  AgentInstance,
  AgentMessage,
  AgentTypeDefinition,
  WorkerResult,
} from '@/core/agent-team/types';
import { AGENT_SAFE_TOOLS, AGENT_STANDARD_TOOLS, COORDINATOR_TOOLS } from '@/core/agent-team/types';

describe('agent-team types', () => {
  describe('AGENT_SAFE_TOOLS', () => {
    it('should contain read-only and search tools', () => {
      expect(AGENT_SAFE_TOOLS).toContain('ReadFile');
      expect(AGENT_SAFE_TOOLS).toContain('Glob');
      expect(AGENT_SAFE_TOOLS).toContain('Grep');
      expect(AGENT_SAFE_TOOLS).toContain('WebFetch');
      expect(AGENT_SAFE_TOOLS).toContain('WebSearch');
      expect(AGENT_SAFE_TOOLS).toContain('GetCurrentTime');
      expect(AGENT_SAFE_TOOLS).toContain('GetWorkdirInfo');
    });

    it('should not contain write or exec tools', () => {
      expect(AGENT_SAFE_TOOLS).not.toContain('WriteFile');
      expect(AGENT_SAFE_TOOLS).not.toContain('EditFile');
      expect(AGENT_SAFE_TOOLS).not.toContain('Exec');
      expect(AGENT_SAFE_TOOLS).not.toContain('Process');
    });

    it('should not contain recursive tools', () => {
      expect(AGENT_SAFE_TOOLS).not.toContain('AgentTool');
      expect(AGENT_SAFE_TOOLS).not.toContain('SpawnSubAgents');
      expect(AGENT_SAFE_TOOLS).not.toContain('SendMessage');
    });
  });

  describe('AGENT_STANDARD_TOOLS', () => {
    it('should include all safe tools', () => {
      for (const tool of AGENT_SAFE_TOOLS) {
        expect(AGENT_STANDARD_TOOLS).toContain(tool);
      }
    });

    it('should include write and exec tools', () => {
      expect(AGENT_STANDARD_TOOLS).toContain('WriteFile');
      expect(AGENT_STANDARD_TOOLS).toContain('EditFile');
      expect(AGENT_STANDARD_TOOLS).toContain('Exec');
      expect(AGENT_STANDARD_TOOLS).toContain('Process');
    });
  });

  describe('COORDINATOR_TOOLS', () => {
    it('should only contain orchestration tools', () => {
      expect(COORDINATOR_TOOLS).toContain('AgentTool');
      expect(COORDINATOR_TOOLS).toContain('SendMessage');
      expect(COORDINATOR_TOOLS).toContain('TaskStop');
      expect(COORDINATOR_TOOLS).toHaveLength(3);
    });

    it('should not contain write or exec tools', () => {
      expect(COORDINATOR_TOOLS).not.toContain('WriteFile');
      expect(COORDINATOR_TOOLS).not.toContain('EditFile');
      expect(COORDINATOR_TOOLS).not.toContain('Exec');
    });
  });

  describe('AgentTypeDefinition structure', () => {
    it('should validate a valid worker type definition', () => {
      const def: AgentTypeDefinition = {
        typeId: 'test-worker',
        displayName: 'Test Worker',
        whenToUse: 'For testing purposes',
        role: 'worker',
        capabilities: [],
        toolPolicy: { mode: 'safe' },
        permissionMode: 'restricted',
        source: 'builtin',
        maxTurns: 30,
        maxSpawnDepth: 0,
        getSystemPrompt: (ctx) => `Task: ${ctx.taskDescription}`,
      };

      expect(def.typeId).toBe('test-worker');
      expect(def.role).toBe('worker');
      expect(def.maxSpawnDepth).toBe(0);
      expect(def.getSystemPrompt({ taskDescription: 'hello', workdir: '/tmp' })).toBe(
        'Task: hello'
      );
    });

    it('should validate coordinator type definition', () => {
      const def: AgentTypeDefinition = {
        typeId: 'my-coordinator',
        displayName: 'Coordinator',
        whenToUse: 'Orchestration',
        role: 'coordinator',
        capabilities: [],
        toolPolicy: { mode: 'inherit' },
        permissionMode: 'inherit',
        source: 'user',
        maxTurns: 100,
        maxSpawnDepth: 2,
        getSystemPrompt: () => 'coordinator prompt',
      };

      expect(def.role).toBe('coordinator');
      expect(def.maxSpawnDepth).toBe(2);
      expect(def.source).toBe('user');
    });

    it('should validate universal type definition', () => {
      const def: AgentTypeDefinition = {
        typeId: 'general',
        displayName: 'General',
        whenToUse: 'Anything',
        role: 'universal',
        capabilities: [],
        toolPolicy: { mode: 'standard' },
        permissionMode: 'inherit',
        source: 'builtin',
        maxTurns: 50,
        maxSpawnDepth: 1,
        getSystemPrompt: () => '',
      };

      expect(def.role).toBe('universal');
    });
  });

  describe('AgentMessage structure', () => {
    it('should create a valid message', () => {
      const msg: AgentMessage = {
        messageId: 'msg-1',
        fromAgentId: 'agent-a',
        toAgentId: 'agent-b',
        type: 'question',
        payload: 'What file should I read?',
        timestamp: Date.now(),
        requiresResponse: true,
      };

      expect(msg.type).toBe('question');
      expect(msg.requiresResponse).toBe(true);
      expect(msg.fromAgentId).toBe('agent-a');
    });

    it('should support task_result type', () => {
      const msg: AgentMessage = {
        messageId: 'msg-2',
        fromAgentId: 'worker-1',
        toAgentId: 'parent',
        type: 'task_result',
        payload: 'Task completed successfully',
        timestamp: Date.now(),
        requiresResponse: false,
        taskId: 'task-1',
      };

      expect(msg.type).toBe('task_result');
      expect(msg.toAgentId).toBe('parent');
      expect(msg.taskId).toBe('task-1');
    });
  });

  describe('AgentInstance structure', () => {
    it('should have required fields', () => {
      // Partial validation of AgentInstance shape
      const instance: Pick<AgentInstance, 'instanceId' | 'typeId' | 'depth' | 'status'> = {
        instanceId: 'inst-1',
        typeId: 'researcher',
        depth: 1,
        status: 'idle',
      };

      expect(instance.depth).toBe(1);
      expect(instance.status).toBe('idle');
    });
  });

  describe('WorkerResult structure', () => {
    it('should have required fields for success', () => {
      const result: WorkerResult = {
        instanceId: 'inst-1',
        typeId: 'researcher',
        taskDescription: 'Search docs',
        status: 'success',
        output: 'Found 3 results',
        artifacts: [],
        duration: 1000,
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          estimatedCostUsd: 0,
        },
      };

      expect(result.status).toBe('success');
      expect(result.output).toBe('Found 3 results');
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should support failure with error', () => {
      const result: WorkerResult = {
        instanceId: 'inst-2',
        typeId: 'coder',
        taskDescription: 'Implement feature',
        status: 'failure',
        output: null,
        artifacts: [],
        error: { code: 'TIMEOUT', message: 'Timed out', retryable: false },
        duration: 5000,
        tokenUsage: {
          inputTokens: 200,
          outputTokens: 0,
          totalTokens: 200,
          estimatedCostUsd: 0,
        },
      };

      expect(result.status).toBe('failure');
      expect(result.error?.code).toBe('TIMEOUT');
    });
  });
});
