import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLlmBasedAgent } from '@/core/agent-runtime/agent-adapter';
import {
  getAgentInstanceManager,
  resetAgentInstanceManager,
} from '@/core/agent-team/agent-instance-manager';
import type { AgentTaskSpec, AgentTypeDefinition } from '@/core/agent-team/types';

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
    prompt: vi.fn(),
    waitForIdle: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
    reset: vi.fn(),
  })),
}));

function mockDef(typeId: string): AgentTypeDefinition {
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
    getSystemPrompt: () => '',
  };
}

function makeTask(taskId: string): AgentTaskSpec {
  return { taskId, description: '', mode: 'sync', timeoutMs: 30000, inheritContext: false };
}

function createTestAgent(agentId: string) {
  return createLlmBasedAgent({
    agentId,
    displayName: `Test ${agentId}`,
    capabilities: [],
  });
}

describe('AgentInstanceManager', () => {
  beforeEach(() => {
    resetAgentInstanceManager();
    vi.clearAllMocks();
  });

  describe('singleton', () => {
    it('getAgentInstanceManager should return same instance', () => {
      const m1 = getAgentInstanceManager();
      const m2 = getAgentInstanceManager();
      expect(m1).toBe(m2);
    });

    it('reset should create new instance', () => {
      const m1 = getAgentInstanceManager();
      resetAgentInstanceManager();
      const m2 = getAgentInstanceManager();
      expect(m1).not.toBe(m2);
    });
  });

  describe('register', () => {
    it('should register a new instance with idle status', () => {
      const manager = getAgentInstanceManager();
      const agent = createTestAgent('agent-1');
      const instance = manager.register(mockDef('researcher'), agent, makeTask('task-1'), null, 1);
      expect(instance.instanceId).toBe('agent-1');
      expect(instance.typeId).toBe('researcher');
      expect(instance.depth).toBe(1);
      expect(instance.status).toBe('idle');
      expect(instance.parentInstanceId).toBeNull();
      expect(instance.childInstanceIds).toEqual([]);
    });

    it('should establish parent-child relationship', () => {
      const manager = getAgentInstanceManager();
      const parent = manager.register(
        mockDef('planner'),
        createTestAgent('parent-1'),
        makeTask('task-1'),
        null,
        0
      );
      manager.register(
        mockDef('researcher'),
        createTestAgent('child-1'),
        makeTask('task-2'),
        parent.instanceId,
        1
      );
      expect(manager.get(parent.instanceId)?.childInstanceIds).toContain('child-1');
    });
  });

  describe('transition', () => {
    function setupAgent(status?: string) {
      const manager = getAgentInstanceManager();
      const agent = createTestAgent('agent-1');
      manager.register(mockDef('coder'), agent, makeTask('t1'), null, 1);
      if (status)
        manager.transition('agent-1', status as 'running' | 'completed' | 'failed' | 'paused');
      return manager;
    }

    it('should allow idle -> running', () => {
      const manager = setupAgent();
      expect(manager.transition('agent-1', 'running')).toBe(true);
      expect(manager.get('agent-1')?.status).toBe('running');
    });

    it('should allow running -> completed', () => {
      const manager = setupAgent('running' as never);
      expect(manager.transition('agent-1', 'completed')).toBe(true);
      expect(manager.get('agent-1')?.status).toBe('completed');
    });

    it('should allow running -> failed', () => {
      const manager = setupAgent('running' as never);
      expect(manager.transition('agent-1', 'failed')).toBe(true);
    });

    it('should allow running -> paused', () => {
      const manager = setupAgent('running' as never);
      expect(manager.transition('agent-1', 'paused')).toBe(true);
    });

    it('should allow paused -> running', () => {
      const manager = getAgentInstanceManager();
      const agent = createTestAgent('agent-1');
      manager.register(mockDef('coder'), agent, makeTask('t1'), null, 1);
      manager.transition('agent-1', 'running');
      manager.transition('agent-1', 'paused');
      expect(manager.transition('agent-1', 'running')).toBe(true);
    });

    it('should deny completed -> running', () => {
      const manager = getAgentInstanceManager();
      const agent = createTestAgent('agent-1');
      manager.register(mockDef('coder'), agent, makeTask('t1'), null, 1);
      manager.transition('agent-1', 'running');
      manager.transition('agent-1', 'completed');
      expect(manager.transition('agent-1', 'running')).toBe(false);
    });

    it('should deny idle -> completed', () => {
      const manager = getAgentInstanceManager();
      const agent = createTestAgent('agent-1');
      manager.register(mockDef('coder'), agent, makeTask('t1'), null, 1);
      expect(manager.transition('agent-1', 'completed')).toBe(false);
    });

    it('should return false for non-existent instance', () => {
      expect(getAgentInstanceManager().transition('non-existent', 'running')).toBe(false);
    });
  });

  describe('query methods', () => {
    it('get should return instance by id', () => {
      const manager = getAgentInstanceManager();
      manager.register(mockDef('researcher'), createTestAgent('agent-1'), makeTask('t1'), null, 1);
      expect(manager.get('agent-1')).toBeDefined();
      expect(manager.get('non-existent')).toBeUndefined();
    });

    it('listAll should return all instances', () => {
      const manager = getAgentInstanceManager();
      manager.register(mockDef('researcher'), createTestAgent('agent-1'), makeTask('t1'), null, 1);
      manager.register(mockDef('coder'), createTestAgent('agent-2'), makeTask('t2'), null, 1);
      expect(manager.listAll()).toHaveLength(2);
    });

    it('listActive should exclude terminal states', () => {
      const manager = getAgentInstanceManager();
      manager.register(mockDef('researcher'), createTestAgent('active-1'), makeTask('t1'), null, 1);
      manager.register(mockDef('coder'), createTestAgent('done-1'), makeTask('t2'), null, 1);
      manager.transition('done-1', 'running');
      manager.transition('done-1', 'completed');
      expect(manager.listActive()).toHaveLength(1);
    });

    it('listByDepth should filter by depth', () => {
      const manager = getAgentInstanceManager();
      manager.register(mockDef('planner'), createTestAgent('depth-0'), makeTask('t1'), null, 0);
      manager.register(mockDef('researcher'), createTestAgent('depth-1'), makeTask('t2'), null, 1);
      manager.register(mockDef('researcher'), createTestAgent('depth-2'), makeTask('t3'), null, 2);
      expect(manager.listByDepth(0)).toHaveLength(1);
      expect(manager.listByDepth(1)).toHaveLength(1);
      expect(manager.listByDepth(2)).toHaveLength(1);
    });

    it('listChildren should return children', () => {
      const manager = getAgentInstanceManager();
      const parent = manager.register(
        mockDef('planner'),
        createTestAgent('parent'),
        makeTask('t1'),
        null,
        0
      );
      manager.register(
        mockDef('researcher'),
        createTestAgent('child-1'),
        makeTask('t2'),
        parent.instanceId,
        1
      );
      manager.register(
        mockDef('researcher'),
        createTestAgent('child-2'),
        makeTask('t3'),
        parent.instanceId,
        1
      );
      expect(manager.listChildren(parent.instanceId)).toHaveLength(2);
    });
  });

  describe('cancel', () => {
    it('should cancel running instance', async () => {
      const manager = getAgentInstanceManager();
      manager.register(mockDef('coder'), createTestAgent('agent-1'), makeTask('t1'), null, 1);
      manager.transition('agent-1', 'running');
      const cancelled = await manager.cancel('agent-1');
      expect(cancelled).toContain('agent-1');
      expect(manager.get('agent-1')?.status).toBe('cancelled');
    });

    it('should recursively cancel children', async () => {
      const manager = getAgentInstanceManager();
      const parent = manager.register(
        mockDef('planner'),
        createTestAgent('parent'),
        makeTask('t1'),
        null,
        0
      );
      manager.register(
        mockDef('researcher'),
        createTestAgent('child'),
        makeTask('t2'),
        parent.instanceId,
        1
      );
      manager.transition('parent', 'running');
      manager.transition('child', 'running');
      const cancelled = await manager.cancel('parent');
      expect(cancelled).toContain('parent');
      expect(cancelled).toContain('child');
    });

    it('should not double-cancel terminal instances', async () => {
      const manager = getAgentInstanceManager();
      manager.register(mockDef('coder'), createTestAgent('agent-1'), makeTask('t1'), null, 1);
      manager.transition('agent-1', 'running');
      manager.transition('agent-1', 'completed');
      expect(await manager.cancel('agent-1')).not.toContain('agent-1');
    });

    it('should return empty for non-existent', async () => {
      expect(await getAgentInstanceManager().cancel('non-existent')).toEqual([]);
    });
  });

  describe('cancelByDepth', () => {
    it('should cancel all active at depth', async () => {
      const manager = getAgentInstanceManager();
      manager.register(mockDef('researcher'), createTestAgent('a'), makeTask('ta'), null, 1);
      manager.register(mockDef('coder'), createTestAgent('b'), makeTask('tb'), null, 1);
      manager.transition('a', 'running');
      manager.transition('b', 'running');
      const cancelled = await manager.cancelByDepth(1);
      expect(cancelled).toContain('a');
      expect(cancelled).toContain('b');
    });
  });

  describe('cleanup', () => {
    it('should remove instance from registry', () => {
      const manager = getAgentInstanceManager();
      manager.register(mockDef('coder'), createTestAgent('agent-1'), makeTask('t1'), null, 1);
      manager.transition('agent-1', 'running');
      manager.transition('agent-1', 'completed');
      manager.cleanup('agent-1');
      expect(manager.get('agent-1')).toBeUndefined();
    });

    it('should recursively cleanup children', () => {
      const manager = getAgentInstanceManager();
      const parent = manager.register(
        mockDef('planner'),
        createTestAgent('parent'),
        makeTask('t1'),
        null,
        0
      );
      manager.register(
        mockDef('researcher'),
        createTestAgent('child'),
        makeTask('t2'),
        parent.instanceId,
        1
      );
      manager.cleanup('parent');
      expect(manager.get('parent')).toBeUndefined();
      expect(manager.get('child')).toBeUndefined();
    });
  });

  describe('cleanupTerminated', () => {
    it('should clean terminal instances', () => {
      const manager = getAgentInstanceManager();
      manager.register(mockDef('coder'), createTestAgent('done'), makeTask('t1'), null, 1);
      manager.register(mockDef('coder'), createTestAgent('active'), makeTask('t2'), null, 1);
      manager.transition('done', 'running');
      manager.transition('done', 'completed');
      expect(manager.cleanupTerminated()).toBe(1);
      expect(manager.get('done')).toBeUndefined();
      expect(manager.get('active')).toBeDefined();
    });
  });

  describe('stats', () => {
    it('should return counts by status', () => {
      const manager = getAgentInstanceManager();
      manager.register(mockDef('coder'), createTestAgent('a1'), makeTask('t1'), null, 1);
      manager.register(mockDef('coder'), createTestAgent('a2'), makeTask('t2'), null, 1);
      manager.register(mockDef('coder'), createTestAgent('a3'), makeTask('t3'), null, 1);
      manager.transition('a1', 'running');
      manager.transition('a2', 'running');
      manager.transition('a2', 'completed');
      const stats = manager.stats();
      expect(stats.idle).toBe(1);
      expect(stats.running).toBe(1);
      expect(stats.completed).toBe(1);
    });
  });

  describe('totalCount and activeCount', () => {
    it('should track correct counts', () => {
      const manager = getAgentInstanceManager();
      manager.register(mockDef('coder'), createTestAgent('agent-1'), makeTask('t1'), null, 1);
      manager.register(mockDef('coder'), createTestAgent('agent-2'), makeTask('t2'), null, 1);
      expect(manager.totalCount).toBe(2);
      expect(manager.activeCount).toBe(2);
      manager.transition('agent-1', 'running');
      manager.transition('agent-1', 'completed');
      expect(manager.activeCount).toBe(1);
    });
  });

  describe('EventEmitter', () => {
    it('should extend EventEmitter', () => {
      const manager = getAgentInstanceManager();
      expect(manager).toBeInstanceOf(EventEmitter);
    });
  });

  describe('event emission', () => {
    it('register should emit instance:registered event', () => {
      const manager = getAgentInstanceManager();
      const events: unknown[] = [];
      manager.on('instance:registered', (e) => events.push(e));

      manager.register(mockDef('researcher'), createTestAgent('agent-1'), makeTask('t1'), null, 1);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        instanceId: 'agent-1',
        typeId: 'researcher',
        depth: 1,
      });
    });

    it('transition should emit instance:transitioned event', () => {
      const manager = getAgentInstanceManager();
      const events: unknown[] = [];
      manager.on('instance:transitioned', (e) => events.push(e));

      manager.register(mockDef('coder'), createTestAgent('agent-1'), makeTask('t1'), null, 1);
      manager.transition('agent-1', 'running');
      manager.transition('agent-1', 'completed');

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ instanceId: 'agent-1', from: 'idle', to: 'running' });
      expect(events[1]).toMatchObject({ instanceId: 'agent-1', from: 'running', to: 'completed' });
    });

    it('setActivity should emit instance:activity event', () => {
      const manager = getAgentInstanceManager();
      const events: unknown[] = [];
      manager.on('instance:activity', (e) => events.push(e));

      manager.register(mockDef('coder'), createTestAgent('agent-1'), makeTask('t1'), null, 1);

      const activity = { toolName: 'ReadFile', toolUses: 1, startedAt: Date.now() };
      manager.setActivity('agent-1', activity);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        instanceId: 'agent-1',
        typeId: 'coder',
        activity: { toolName: 'ReadFile', toolUses: 1 },
      });
    });
  });

  describe('setActivity / getActivity', () => {
    it('setActivity should update currentActivity on instance', () => {
      const manager = getAgentInstanceManager();
      manager.register(mockDef('coder'), createTestAgent('agent-1'), makeTask('t1'), null, 1);

      const activity = {
        toolName: 'ReadFile',
        toolUses: 5,
        args: 'path:test.txt',
        startedAt: Date.now(),
      };
      manager.setActivity('agent-1', activity);

      expect(manager.get('agent-1')?.currentActivity).toEqual(activity);
    });

    it('setActivity should be no-op for non-existent instance', () => {
      const manager = getAgentInstanceManager();
      expect(() =>
        manager.setActivity('non-existent', {
          toolName: 'ReadFile',
          toolUses: 1,
          startedAt: Date.now(),
        })
      ).not.toThrow();
    });

    it('getActivity should return current activity', () => {
      const manager = getAgentInstanceManager();
      manager.register(mockDef('coder'), createTestAgent('agent-1'), makeTask('t1'), null, 1);

      const activity = { toolName: 'WriteFile', toolUses: 3, startedAt: Date.now() };
      manager.setActivity('agent-1', activity);

      expect(manager.getActivity('agent-1')).toEqual(activity);
    });

    it('getActivity should return undefined for non-existent instance', () => {
      const manager = getAgentInstanceManager();
      expect(manager.getActivity('non-existent')).toBeUndefined();
    });

    it('getActivity should return undefined when no activity set', () => {
      const manager = getAgentInstanceManager();
      manager.register(mockDef('coder'), createTestAgent('agent-1'), makeTask('t1'), null, 1);
      expect(manager.getActivity('agent-1')).toBeUndefined();
    });
  });

  describe('recordToolCall', () => {
    it('should record tool call in toolCallHistory', () => {
      const manager = getAgentInstanceManager();
      manager.register(mockDef('coder'), createTestAgent('agent-1'), makeTask('t1'), null, 1);

      manager.recordToolCall('agent-1', {
        toolName: 'ReadFile',
        toolCallId: 'call-1',
        status: 'running',
        startedAt: Date.now(),
      });

      const inst = manager.get('agent-1');
      expect(inst?.toolCallHistory).toHaveLength(1);
      expect(inst?.toolCallHistory[0]?.toolName).toBe('ReadFile');
      expect(inst?.toolCallHistory[0]?.status).toBe('running');
    });

    it('should emit instance:toolcall event', () => {
      const manager = getAgentInstanceManager();
      const events: unknown[] = [];
      manager.on('instance:toolcall', (e) => events.push(e));

      manager.register(mockDef('coder'), createTestAgent('agent-1'), makeTask('t1'), null, 1);
      manager.recordToolCall('agent-1', {
        toolName: 'Grep',
        status: 'running',
        startedAt: Date.now(),
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        instanceId: 'agent-1',
        typeId: 'coder',
        record: { toolName: 'Grep', status: 'running' },
      });
    });

    it('should update currentActivity on each call', () => {
      const manager = getAgentInstanceManager();
      manager.register(mockDef('coder'), createTestAgent('agent-1'), makeTask('t1'), null, 1);

      manager.recordToolCall('agent-1', {
        toolName: 'ReadFile',
        argsDisplay: 'src/foo.ts',
        status: 'completed',
        startedAt: 1000,
      });

      expect(manager.getActivity('agent-1')).toMatchObject({
        toolName: 'ReadFile',
        toolUses: 1,
        args: 'src/foo.ts',
      });
    });

    it('should accumulate toolUses across multiple calls', () => {
      const manager = getAgentInstanceManager();
      manager.register(mockDef('coder'), createTestAgent('agent-1'), makeTask('t1'), null, 1);

      manager.recordToolCall('agent-1', {
        toolName: 'ReadFile',
        status: 'completed',
        startedAt: 1000,
      });
      manager.recordToolCall('agent-1', {
        toolName: 'Grep',
        status: 'completed',
        startedAt: 2000,
      });
      manager.recordToolCall('agent-1', {
        toolName: 'ReadFile',
        status: 'completed',
        startedAt: 3000,
      });

      expect(manager.getActivity('agent-1')?.toolUses).toBe(3);
    });

    it('should be no-op for non-existent instance', () => {
      const manager = getAgentInstanceManager();
      expect(() =>
        manager.recordToolCall('non-existent', {
          toolName: 'ReadFile',
          status: 'running',
          startedAt: Date.now(),
        })
      ).not.toThrow();
    });
  });
});
