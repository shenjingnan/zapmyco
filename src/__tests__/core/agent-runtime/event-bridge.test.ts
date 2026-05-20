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
        {
          type: 'turn_end',
          message: { role: 'assistant', content: [{ type: 'text', text: '' }] } as never,
          toolResults: [],
        },
        'task-1',
        'agent-1'
      );
      expect(result).toEqual({ type: 'turn:end', taskId: 'task-1' });
    });

    it('should convert message_start event with text content', () => {
      const msg = { role: 'assistant', content: [{ type: 'text', text: 'Hello world' }] } as never;
      const result = adaptAgentEvent({ type: 'message_start', message: msg }, 'task-1', 'agent-1');
      expect(result).toMatchObject({
        type: 'message:start',
        taskId: 'task-1',
        textPreview: 'Hello world',
      });
    });

    it('should skip message_update events (no subscribers for task:output)', () => {
      const evt = { type: 'text_delta', delta: 'some text' };
      const result = adaptAgentEvent(
        {
          type: 'message_update',
          message: { role: 'assistant', content: [] } as never,
          assistantMessageEvent: evt as never,
        },
        'task-1',
        'agent-1'
      );
      expect(result).toBeNull();
    });

    it('should convert message_end event', () => {
      const msg = {
        role: 'assistant',
        content: [{ type: 'text', text: 'Full response' }],
      } as never;
      const result = adaptAgentEvent({ type: 'message_end', message: msg }, 'task-1', 'agent-1');
      expect(result).toMatchObject({
        type: 'message:end',
        taskId: 'task-1',
        fullMessage: 'Full response',
      });
    });

    it('should convert tool_execution_start event', () => {
      const result = adaptAgentEvent(
        {
          type: 'tool_execution_start',
          toolCallId: 'call-1',
          toolName: 'ReadFile',
          args: { file_path: '/a/b.txt' },
        },
        'task-1',
        'agent-1'
      );
      expect(result).toEqual({
        type: 'tool:start',
        taskId: 'task-1',
        toolName: 'ReadFile',
        toolCallId: 'call-1',
        args: { file_path: '/a/b.txt' },
      });
    });

    it('should convert tool_execution_update event', () => {
      const result = adaptAgentEvent(
        {
          type: 'tool_execution_update',
          toolCallId: 'call-1',
          toolName: 'ReadFile',
          args: {},
          partialResult: {},
        },
        'task-1',
        'agent-1'
      );
      expect(result).toEqual({
        type: 'tool:update',
        taskId: 'task-1',
        toolName: 'ReadFile',
      });
    });

    it('should convert tool_execution_end event (success)', () => {
      const result = adaptAgentEvent(
        {
          type: 'tool_execution_end',
          toolCallId: 'call-1',
          toolName: 'ReadFile',
          result: {},
          isError: false,
        },
        'task-1',
        'agent-1'
      );
      expect(result).toEqual({
        type: 'tool:end',
        taskId: 'task-1',
        toolName: 'ReadFile',
        toolCallId: 'call-1',
        success: true,
      });
    });

    it('should convert tool_execution_end event (failure)', () => {
      const result = adaptAgentEvent(
        {
          type: 'tool_execution_end',
          toolCallId: 'call-1',
          toolName: 'ReadFile',
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

    it('should format tool:start with args as toolName(key="value")', () => {
      const spy = vi.spyOn(eventBus, 'emit');
      dispatchToEventBus({
        type: 'tool:start',
        taskId: 't1',
        toolName: 'ReadFile',
        toolCallId: 'c1',
        args: { file_path: '/path/to/file', pattern: '*.ts' },
      });
      expect(spy).toHaveBeenCalledWith('task:progress', {
        taskId: 't1',
        percent: 0,
        message: 'ReadFile(file_path="/path/to/file", pattern="*.ts")',
      });
      spy.mockRestore();
    });

    it('should format tool:start with empty args as toolName only', () => {
      const spy = vi.spyOn(eventBus, 'emit');
      dispatchToEventBus({
        type: 'tool:start',
        taskId: 't1',
        toolName: 'list_files',
        toolCallId: 'c1',
        args: {},
      });
      expect(spy).toHaveBeenCalledWith('task:progress', {
        taskId: 't1',
        percent: 0,
        message: 'list_files()',
      });
      spy.mockRestore();
    });

    it('should format tool:start with null args as toolName only', () => {
      const spy = vi.spyOn(eventBus, 'emit');
      dispatchToEventBus({
        type: 'tool:start',
        taskId: 't1',
        toolName: 'ping',
        toolCallId: 'c1',
        args: null,
      });
      expect(spy).toHaveBeenCalledWith('task:progress', {
        taskId: 't1',
        percent: 0,
        message: 'ping()',
      });
      spy.mockRestore();
    });

    it('should truncate long string args in tool:start formatting', () => {
      const spy = vi.spyOn(eventBus, 'emit');
      const longStr = 'a'.repeat(100);
      dispatchToEventBus({
        type: 'tool:start',
        taskId: 't1',
        toolName: 'bash',
        toolCallId: 'c1',
        args: { command: longStr },
      });
      const callArg = spy.mock.calls[0]?.[1] as { message: string };
      expect(callArg.message).toContain('...');
      expect(callArg.message.length).toBeLessThan(longStr.length + 20);
      spy.mockRestore();
    });

    it('should format tool:start with non-string args using JSON.stringify', () => {
      const spy = vi.spyOn(eventBus, 'emit');
      dispatchToEventBus({
        type: 'tool:start',
        taskId: 't1',
        toolName: 'some_tool',
        toolCallId: 'c1',
        args: { count: 42, enabled: true },
      });
      expect(spy).toHaveBeenCalledWith('task:progress', {
        taskId: 't1',
        percent: 0,
        message: 'some_tool(count="42", enabled="true")',
      });
      spy.mockRestore();
    });
  });

  describe('createEventBridgeListener', () => {
    it('should return a function that calls adaptAgentEvent and dispatchToEventBus', () => {
      const listener = createEventBridgeListener('task-1', 'agent-1');

      expect(typeof listener).toBe('function');

      // Verify the listener can be called without throwing for agent_start event
      // (AbortSignal may not be constructable in all test environments)
      const spy = vi.spyOn(eventBus, 'emit');
      try {
        listener({ type: 'agent_start' }, {} as AbortSignal);
      } catch {
        // AbortSignal constructor may not be available in test environment
      }
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('should return null for unknown event type', () => {
      const listener = createEventBridgeListener('task-1', 'agent-1');
      const spy = vi.spyOn(eventBus, 'emit');
      listener({ type: 'unknown_type' as never }, {} as AbortSignal);
      // 未知事件类型 adapt 返回 null，不会触发 dispatchToEventBus
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
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
      expect(spy).toHaveBeenCalledWith('task:completed', { taskId: 't1', result: {} });
      spy.mockRestore();
    });

    it('should emit task:started for turn:start', () => {
      const spy = vi.spyOn(eventBus, 'emit');
      dispatchToEventBus({ type: 'turn:start', taskId: 't1' });
      expect(spy).toHaveBeenCalledWith('task:started', { taskId: 't1', agentId: '' });
      spy.mockRestore();
    });

    it('should emit task:progress for turn:end', () => {
      const spy = vi.spyOn(eventBus, 'emit');
      dispatchToEventBus({ type: 'turn:end', taskId: 't1' });
      expect(spy).toHaveBeenCalledWith('task:progress', {
        taskId: 't1',
        percent: 100,
        message: 'Turn completed',
      });
      spy.mockRestore();
    });

    it('should emit task:output for message:start', () => {
      const spy = vi.spyOn(eventBus, 'emit');
      dispatchToEventBus({
        type: 'message:start',
        taskId: 't1',
        textPreview: 'Hello',
      });
      expect(spy).toHaveBeenCalledWith('task:output', {
        taskId: 't1',
        text: '[开始生成] Hello',
      });
      spy.mockRestore();
    });

    it('should emit task:output for message:end', () => {
      const spy = vi.spyOn(eventBus, 'emit');
      dispatchToEventBus({
        type: 'message:end',
        taskId: 't1',
        fullMessage: 'complete msg',
      });
      expect(spy).toHaveBeenCalledWith('task:output', { taskId: 't1', text: 'complete msg' });
      spy.mockRestore();
    });

    it('should emit task:progress for tool:start', () => {
      const spy = vi.spyOn(eventBus, 'emit');
      dispatchToEventBus({
        type: 'tool:start',
        taskId: 't1',
        toolName: 'ReadFile',
        toolCallId: 'call-1',
        args: { file: 'test.ts' },
      });
      expect(spy).toHaveBeenCalledWith(
        'task:progress',
        expect.objectContaining({ taskId: 't1', percent: 0 })
      );
      spy.mockRestore();
    });

    it('should emit task:progress for tool:update', () => {
      const spy = vi.spyOn(eventBus, 'emit');
      dispatchToEventBus({ type: 'tool:update', taskId: 't1', toolName: 'ReadFile' });
      expect(spy).toHaveBeenCalledWith(
        'task:progress',
        expect.objectContaining({ taskId: 't1', message: 'ReadFile 更新中' })
      );
      spy.mockRestore();
    });

    it('should emit task:progress for tool:end success', () => {
      const spy = vi.spyOn(eventBus, 'emit');
      dispatchToEventBus({
        type: 'tool:end',
        taskId: 't1',
        toolName: 'ReadFile',
        toolCallId: 'call-1',
        success: true,
      });
      expect(spy).toHaveBeenCalledWith(
        'task:progress',
        expect.objectContaining({ message: '工具 ReadFile 完成' })
      );
      spy.mockRestore();
    });

    it('should emit task:progress for tool:end failure', () => {
      const spy = vi.spyOn(eventBus, 'emit');
      dispatchToEventBus({
        type: 'tool:end',
        taskId: 't1',
        toolName: 'ReadFile',
        toolCallId: 'call-1',
        success: false,
      });
      expect(spy).toHaveBeenCalledWith(
        'task:progress',
        expect.objectContaining({ message: '工具 ReadFile 失败' })
      );
      spy.mockRestore();
    });

    it('should emit task:failed for error', () => {
      const spy = vi.spyOn(eventBus, 'emit');
      const err = new Error('test error');
      dispatchToEventBus({
        type: 'error',
        taskId: 't1',
        error: err,
      });
      expect(spy).toHaveBeenCalledWith('task:failed', {
        taskId: 't1',
        error: err,
        retryable: false,
      });
      spy.mockRestore();
    });
  });

  describe('adaptAgentEvent - additional cases', () => {
    it('should skip message_update events (no subscribers for task:output)', () => {
      const result = adaptAgentEvent(
        {
          type: 'message_update',
          message: { role: 'assistant', content: [] } as never,
          assistantMessageEvent: { type: 'thinking_delta', thinking_delta: 'thinking...' },
        } as never,
        'task-1',
        'agent-1'
      );
      expect(result).toBeNull();
    });

    it('should convert message_end event with full content', () => {
      const msg = {
        role: 'assistant',
        content: 'direct string content',
      } as never;
      const result = adaptAgentEvent(
        { type: 'message_end', message: msg, toolResults: [] } as never,
        'task-1',
        'agent-1'
      );
      expect(result).toMatchObject({
        type: 'message:end',
        taskId: 'task-1',
        fullMessage: 'direct string content',
      });
    });

    it('should return null for unknown event type', () => {
      const result = adaptAgentEvent({ type: 'unknown_type' as never }, 'task-1', 'agent-1');
      expect(result).toBeNull();
    });
  });
});
