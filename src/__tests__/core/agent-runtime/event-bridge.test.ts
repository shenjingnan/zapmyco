import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adaptAgentEvent,
  createEventBridgeListener,
  dispatchToEventBus,
} from '@/core/agent-runtime/event-bridge';
import { eventBus } from '@/infra/event-bus';

describe('event-bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('adaptAgentEvent', () => {
    it('should convert agent_start event', () => {
      const result = adaptAgentEvent({ type: 'agent_start' }, 'task-1', 'agent-1');
      expect(result).toEqual({
        type: 'agent:start',
        taskId: 'task-1',
        agentId: 'agent-1',
      });
    });

    it('should convert agent_end event', () => {
      const result = adaptAgentEvent({ type: 'agent_end', messages: [] }, 'task-1', 'agent-1');
      expect(result).toEqual({
        type: 'agent:end',
        taskId: 'task-1',
        agentId: 'agent-1',
      });
    });

    it('should convert turn_start event', () => {
      const result = adaptAgentEvent({ type: 'turn_start' }, 'task-1', 'agent-1');
      expect(result).toEqual({ type: 'turn:start', taskId: 'task-1' });
    });

    it('should convert turn_end event', () => {
      const result = adaptAgentEvent(
        { type: 'turn_end', message: { role: 'assistant', content: '' }, toolResults: [] },
        'task-1',
        'agent-1'
      );
      expect(result).toEqual({ type: 'turn:end', taskId: 'task-1' });
    });

    it('should convert message_start event with text content', () => {
      const msg = { role: 'assistant', content: 'Hello world' };
      const result = adaptAgentEvent({ type: 'message_start', message: msg }, 'task-1', 'agent-1');
      expect(result).toMatchObject({
        type: 'message:start',
        taskId: 'task-1',
        textPreview: 'Hello world',
      });
    });

    it('should convert message_update event', () => {
      const evt = { type: 'text_delta', delta: 'some text' };
      const result = adaptAgentEvent(
        { type: 'message_update', message: {}, assistantMessageEvent: evt },
        'task-1',
        'agent-1'
      );
      expect(result).toEqual({
        type: 'message:update',
        taskId: 'task-1',
        delta: 'some text',
      });
    });

    it('should convert message_end event', () => {
      const msg = { role: 'assistant', content: 'Full response' };
      const result = adaptAgentEvent({ type: 'message_end', message: msg }, 'task-1', 'agent-1');
      expect(result).toMatchObject({
        type: 'message:end',
        taskId: 'task-1',
        fullMessage: 'Full response',
      });
    });

    it('should convert tool_execution_start event', () => {
      const result = adaptAgentEvent(
        { type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'read_file', args: {} },
        'task-1',
        'agent-1'
      );
      expect(result).toEqual({
        type: 'tool:start',
        taskId: 'task-1',
        toolName: 'read_file',
        toolCallId: 'call-1',
      });
    });

    it('should convert tool_execution_update event', () => {
      const result = adaptAgentEvent(
        {
          type: 'tool_execution_update',
          toolCallId: 'call-1',
          toolName: 'read_file',
          args: {},
          partialResult: {},
        },
        'task-1',
        'agent-1'
      );
      expect(result).toEqual({
        type: 'tool:update',
        taskId: 'task-1',
        toolName: 'read_file',
      });
    });

    it('should convert tool_execution_end event (success)', () => {
      const result = adaptAgentEvent(
        {
          type: 'tool_execution_end',
          toolCallId: 'call-1',
          toolName: 'read_file',
          result: {},
          isError: false,
        },
        'task-1',
        'agent-1'
      );
      expect(result).toEqual({
        type: 'tool:end',
        taskId: 'task-1',
        toolName: 'read_file',
        toolCallId: 'call-1',
        success: true,
      });
    });

    it('should convert tool_execution_end event (failure)', () => {
      const result = adaptAgentEvent(
        {
          type: 'tool_execution_end',
          toolCallId: 'call-1',
          toolName: 'read_file',
          result: {},
          isError: true,
        },
        'task-1',
        'agent-1'
      );
      expect(result).toMatchObject({
        type: 'tool:end',
        success: false,
      });
    });

    it('should return null for unknown event types', () => {
      // Cast to never to simulate unrecognized event
      const result = adaptAgentEvent({ type: 'unknown_type' } as never, 'task-1', 'agent-1');
      expect(result).toBeNull();
    });
  });

  describe('dispatchToEventBus', () => {
    it('should emit agent:online for agent:start', () => {
      const spy = vi.spyOn(eventBus, 'emit');
      dispatchToEventBus({ type: 'agent:start', taskId: 't1', agentId: 'a1' });
      expect(spy).toHaveBeenCalledWith('agent:online', { agentId: 'a1' });
      spy.mockRestore();
    });

    it('should emit task:completed for agent:end', () => {
      const spy = vi.spyOn(eventBus, 'emit');
      dispatchToEventBus({ type: 'agent:end', taskId: 't1', agentId: 'a1' });
      expect(spy).toHaveBeenCalledWith('task:completed', {
        taskId: 't1',
        result: {},
      });
      spy.mockRestore();
    });

    it('should emit task:output for message:update with text', () => {
      const spy = vi.spyOn(eventBus, 'emit');
      dispatchToEventBus({ type: 'message:update', taskId: 't1', delta: 'hello' });
      expect(spy).toHaveBeenCalledWith('task:output', { taskId: 't1', text: 'hello' });
      spy.mockRestore();
    });

    it('should emit task:failed for error events', () => {
      const spy = vi.spyOn(eventBus, 'emit');
      const err = new Error('test error');
      dispatchToEventBus({ type: 'error', taskId: 't1', error: err });
      expect(spy).toHaveBeenCalledWith('task:failed', {
        taskId: 't1',
        error: err,
        retryable: false,
      });
      spy.mockRestore();
    });
  });

  describe('createEventBridgeListener', () => {
    it('should return a function that calls adaptAgentEvent and dispatchToEventBus', () => {
      const listener = createEventBridgeListener('task-1', 'agent-1');

      expect(typeof listener).toBe('function');

      // Should not throw when called with valid event
      const spy = vi.spyOn(eventBus, 'emit');
      listener({ type: 'agent_start' });
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
