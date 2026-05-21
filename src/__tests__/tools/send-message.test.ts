import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSendMessageTool } from '@/cli/repl/tools/send-message';
import type { LlmBasedAgent } from '@/core/agent-runtime';
import type { TextContent } from '@/core/agent-runtime/runtime-types';
import {
  getAgentInstanceManager,
  resetAgentInstanceManager,
} from '@/core/agent-team/agent-instance-manager';
import { getAgentMessageBus, resetAgentMessageBus } from '@/core/agent-team/agent-message-bus';
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

describe('createSendMessageTool', () => {
  beforeEach(() => {
    resetAgentMessageBus();
    resetAgentInstanceManager();
  });

  function registerAgent(id: string) {
    getAgentInstanceManager().register(
      createMockDef('worker'),
      { agentId: id } as unknown as LlmBasedAgent,
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

  describe('tool registration', () => {
    it('should create tool with correct id', () => {
      const tool = createSendMessageTool('worker-1');
      expect(tool.id).toBe('SendMessage');
      expect(tool.label).toBe('发送消息');
      expect(tool.defaultRisk).toBe('medium');
    });

    it('should include current agent instance ID in description', () => {
      const tool = createSendMessageTool('worker-1');
      expect(tool.description).toContain('worker-1');
    });

    it('should have messageType parameter with correct enum', () => {
      const tool = createSendMessageTool('worker-1');
      const params = tool.parameters as { properties: Record<string, unknown> };
      expect(params.properties).toHaveProperty('toAgentId');
      expect(params.properties).toHaveProperty('message');
      expect(params.properties).toHaveProperty('messageType');
    });
  });

  describe('execute', () => {
    it('should send message and return confirmation', async () => {
      registerAgent('coordinator-1');

      const tool = createSendMessageTool('worker-1');
      const result = await tool.execute('call-1', {
        toAgentId: 'coordinator-1',
        message: 'I need clarification on the task',
        messageType: 'question',
      });

      expect((result.content?.[0] as TextContent)?.text).toContain('消息已发送');
      expect((result.content?.[0] as TextContent)?.text).toContain('coordinator-1');

      const bus = getAgentMessageBus();
      const messages = bus.drainInbox('coordinator-1');
      expect(messages).toHaveLength(1);
      expect(messages[0]?.fromAgentId).toBe('worker-1');
      expect(messages[0]?.payload).toBe('I need clarification on the task');
      expect(messages[0]?.type).toBe('question');
      expect(messages[0]?.requiresResponse).toBe(true);
    });

    it('should default messageType to progress', async () => {
      registerAgent('coordinator-2');

      const tool = createSendMessageTool('worker-2');
      await tool.execute('call-1', {
        toAgentId: 'coordinator-2',
        message: 'progress report',
      });

      const bus = getAgentMessageBus();
      const messages = bus.drainInbox('coordinator-2');
      expect(messages[0]?.type).toBe('progress');
      expect(messages[0]?.requiresResponse).toBe(false);
    });

    it('should map "result" messageType to "task_result"', async () => {
      registerAgent('coordinator-3');

      const tool = createSendMessageTool('worker-3');
      await tool.execute('call-1', {
        toAgentId: 'coordinator-3',
        message: 'intermediate result',
        messageType: 'result',
      });

      const bus = getAgentMessageBus();
      const messages = bus.drainInbox('coordinator-3');
      expect(messages[0]?.type).toBe('task_result');
    });
  });
});
