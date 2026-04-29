import { describe, expect, it } from 'vitest';
import type { AdaptedAgentEvent, ToolExecutionMode } from '@/core/agent-runtime/types';

describe('agent-runtime types', () => {
  describe('ToolExecutionMode', () => {
    it('should accept valid execution modes', () => {
      const sequential: ToolExecutionMode = 'sequential';
      const parallel: ToolExecutionMode = 'parallel';

      expect(sequential).toBe('sequential');
      expect(parallel).toBe('parallel');
    });
  });

  describe('AgentRuntimeConfig', () => {
    it('should allow minimal config with only enabled', () => {
      const config: AgentRuntimeConfig = { enabled: true };

      expect(config.enabled).toBe(true);
    });

    it('should allow full config', () => {
      const config: AgentRuntimeConfig = {
        enabled: true,
        toolExecution: 'parallel',
        maxTurns: 100,
        thinkingLevel: 'high',
      };

      expect(config.toolExecution).toBe('parallel');
      expect(config.maxTurns).toBe(100);
      expect(config.thinkingLevel).toBe('high');
    });
  });

  describe('AdaptedAgentEvent', () => {
    it('should support all event type variants', () => {
      const start: AdaptedAgentEvent = { type: 'agent:start', taskId: 't1', agentId: 'a1' };
      const end: AdaptedAgentEvent = { type: 'agent:end', taskId: 't1', agentId: 'a1' };
      const turnStart: AdaptedAgentEvent = { type: 'turn:start', taskId: 't1' };
      const turnEnd: AdaptedAgentEvent = { type: 'turn:end', taskId: 't1' };
      const msgStart: AdaptedAgentEvent = {
        type: 'message:start',
        taskId: 't1',
        textPreview: 'hi',
      };
      const msgUpdate: AdaptedAgentEvent = { type: 'message:update', taskId: 't1', delta: 'text' };
      const msgEnd: AdaptedAgentEvent = { type: 'message:end', taskId: 't1', fullMessage: 'done' };
      const toolStart: AdaptedAgentEvent = {
        type: 'tool:start',
        taskId: 't1',
        toolName: 'tool',
        toolCallId: 'c1',
      };
      const toolUpdate: AdaptedAgentEvent = { type: 'tool:update', taskId: 't1', toolName: 'tool' };
      const toolEnd: AdaptedAgentEvent = {
        type: 'tool:end',
        taskId: 't1',
        toolName: 'tool',
        toolCallId: 'c1',
        success: true,
      };
      const error: AdaptedAgentEvent = { type: 'error', taskId: 't1', error: new Error('err') };

      expect(start.type).toBe('agent:start');
      expect(end.type).toBe('agent:end');
      expect(turnStart.type).toBe('turn:start');
      expect(turnEnd.type).toBe('turn:end');
      expect(msgStart.type).toBe('message:start');
      expect(msgUpdate.type).toBe('message:update');
      expect(msgEnd.type).toBe('message:end');
      expect(toolStart.type).toBe('tool:start');
      expect(toolUpdate.type).toBe('tool:update');
      expect(toolEnd.type).toBe('tool:end');
      expect(error.type).toBe('error');
    });
  });
});
