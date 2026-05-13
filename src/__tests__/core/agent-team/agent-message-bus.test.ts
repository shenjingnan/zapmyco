import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmBasedAgent } from '@/core/agent-runtime/agent-adapter';
import {
  getAgentInstanceManager,
  resetAgentInstanceManager,
} from '@/core/agent-team/agent-instance-manager';
import {
  type AgentMessageBus,
  getAgentMessageBus,
  resetAgentMessageBus,
} from '@/core/agent-team/agent-message-bus';
import type { AgentMessage, AgentTypeDefinition } from '@/core/agent-team/types';

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

function createMockAgent(agentId: string): LlmBasedAgent {
  return { agentId } as unknown as LlmBasedAgent;
}

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

describe('AgentMessageBus', () => {
  let bus: AgentMessageBus;

  beforeEach(() => {
    resetAgentMessageBus();
    resetAgentInstanceManager();
    bus = getAgentMessageBus();
  });

  function registerAgent(id: string) {
    const agent = createMockAgent(id);
    getAgentInstanceManager().register(
      createMockDef('worker'),
      agent,
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
  }

  describe('publish', () => {
    it('should publish a message and deliver to target inbox', () => {
      registerAgent('agent-1');

      const msg = bus.publish('agent-0', 'agent-1', {
        type: 'question',
        payload: 'Hello?',
        requiresResponse: true,
        taskId: 't1',
      });

      expect(msg.messageId).toMatch(/^msg-/);
      expect(msg.fromAgentId).toBe('agent-0');
      expect(msg.toAgentId).toBe('agent-1');
      expect(msg.type).toBe('question');
      expect(msg.payload).toBe('Hello?');

      const instance = getAgentInstanceManager().get('agent-1');
      expect(instance?.inbox).toHaveLength(1);
      expect(instance?.inbox[0]?.payload).toBe('Hello?');
    });

    it('should warn when target agent does not exist', () => {
      // Should not throw
      bus.publish('agent-0', 'nonexistent', {
        type: 'progress',
        payload: 'test',
        requiresResponse: false,
      });
    });

    it('should trigger subscriber callback', () => {
      registerAgent('agent-2');

      const received: AgentMessage[] = [];
      bus.subscribe('agent-2', (msg) => received.push(msg));

      bus.publish('agent-0', 'agent-2', {
        type: 'progress',
        payload: 'working',
        requiresResponse: false,
      });

      expect(received).toHaveLength(1);
      expect(received[0]?.payload).toBe('working');
    });
  });

  describe('subscribe / unsubscribe', () => {
    it('should not trigger after unsubscribe', () => {
      registerAgent('agent-3');

      const received: AgentMessage[] = [];
      const cb = (msg: AgentMessage) => received.push(msg);
      bus.subscribe('agent-3', cb);
      bus.unsubscribe('agent-3', cb);

      bus.publish('agent-0', 'agent-3', {
        type: 'progress',
        payload: 'test',
        requiresResponse: false,
      });

      expect(received).toHaveLength(0);
    });
  });

  describe('drainInbox', () => {
    it('should return and clear inbox messages', () => {
      registerAgent('agent-4');

      bus.publish('agent-0', 'agent-4', {
        type: 'progress',
        payload: 'msg1',
        requiresResponse: false,
      });
      bus.publish('agent-0', 'agent-4', {
        type: 'progress',
        payload: 'msg2',
        requiresResponse: false,
      });

      const messages = bus.drainInbox('agent-4');
      expect(messages).toHaveLength(2);

      // Inbox should be empty after drain
      expect(bus.drainInbox('agent-4')).toHaveLength(0);
    });

    it('should return empty array for non-existent agent', () => {
      expect(bus.drainInbox('nonexistent')).toEqual([]);
    });
  });

  describe('inboxCount', () => {
    it('should return inbox message count', () => {
      registerAgent('agent-5');

      expect(bus.inboxCount('agent-5')).toBe(0);
      bus.publish('agent-0', 'agent-5', {
        type: 'progress',
        payload: 'test',
        requiresResponse: false,
      });
      expect(bus.inboxCount('agent-5')).toBe(1);
    });

    it('should return 0 for non-existent agent', () => {
      expect(bus.inboxCount('nonexistent')).toBe(0);
    });
  });

  describe('singleton', () => {
    it('should return same instance from getAgentMessageBus', () => {
      const a = getAgentMessageBus();
      const b = getAgentMessageBus();
      expect(a).toBe(b);
    });

    it('should create new instance after reset', () => {
      const a = getAgentMessageBus();
      resetAgentMessageBus();
      const b = getAgentMessageBus();
      expect(a).not.toBe(b);
    });
  });
});
