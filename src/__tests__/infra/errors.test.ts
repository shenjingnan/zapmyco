import { describe, expect, it } from 'vitest';
import {
  AgentError,
  DecomposeError,
  IntentError,
  LlmError,
  SchedulerError,
  ZapmycoError,
  ZapmycoErrorCode,
} from '@/infra/errors';

describe('ZapmycoErrorCode', () => {
  it('should contain all intent error codes', () => {
    expect(ZapmycoErrorCode.INTENT_PARSE_FAILED).toBe('INTENT_PARSE_FAILED');
    expect(ZapmycoErrorCode.INTENT_LOW_CONFIDENCE).toBe('INTENT_LOW_CONFIDENCE');
  });

  it('should contain all decompose error codes', () => {
    expect(ZapmycoErrorCode.DECOMPOSE_FAILED).toBe('DECOMPOSE_FAILED');
    expect(ZapmycoErrorCode.DECOMPOSE_INVALID_GRAPH).toBe('DECOMPOSE_INVALID_GRAPH');
  });

  it('should contain all scheduler error codes', () => {
    expect(ZapmycoErrorCode.SCHEDULER_NO_AVAILABLE_AGENT).toBe('SCHEDULER_NO_AVAILABLE_AGENT');
    expect(ZapmycoErrorCode.SCHEDULER_CAPABILITY_MISMATCH).toBe('SCHEDULER_CAPABILITY_MISMATCH');
    expect(ZapmycoErrorCode.SCHEDULER_TASK_TIMEOUT).toBe('SCHEDULER_TASK_TIMEOUT');
  });

  it('should contain all agent error codes', () => {
    expect(ZapmycoErrorCode.AGENT_NOT_FOUND).toBe('AGENT_NOT_FOUND');
    expect(ZapmycoErrorCode.AGENT_OFFLINE).toBe('AGENT_OFFLINE');
    expect(ZapmycoErrorCode.AGENT_EXECUTION_FAILED).toBe('AGENT_EXECUTION_FAILED');
    expect(ZapmycoErrorCode.AGENT_HEALTH_CHECK_FAILED).toBe('AGENT_HEALTH_CHECK_FAILED');
  });

  it('should contain all config error codes', () => {
    expect(ZapmycoErrorCode.CONFIG_LOAD_FAILED).toBe('CONFIG_LOAD_FAILED');
    expect(ZapmycoErrorCode.CONFIG_INVALID).toBe('CONFIG_INVALID');
  });

  it('should contain all llm error codes', () => {
    expect(ZapmycoErrorCode.LLM_API_ERROR).toBe('LLM_API_ERROR');
    expect(ZapmycoErrorCode.LLM_RATE_LIMITED).toBe('LLM_RATE_LIMITED');
    expect(ZapmycoErrorCode.LLM_QUOTA_EXCEEDED).toBe('LLM_QUOTA_EXCEEDED');
  });

  it('should contain general error codes', () => {
    expect(ZapmycoErrorCode.UNKNOWN).toBe('UNKNOWN');
    expect(ZapmycoErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
  });
});

describe('ZapmycoError', () => {
  it('should create instance with code and message', () => {
    const err = new ZapmycoError(ZapmycoErrorCode.UNKNOWN, 'test message');
    expect(err.code).toBe(ZapmycoErrorCode.UNKNOWN);
    expect(err.message).toBe('test message');
    expect(err.name).toBe('ZapmycoError');
  });

  it('should store context when provided', () => {
    const ctx = { key: 'val', num: 42 };
    const err = new ZapmycoError(ZapmycoErrorCode.UNKNOWN, 'test', ctx);
    expect(err.context).toEqual(ctx);
  });

  it('should omit context property when not provided', () => {
    const err = new ZapmycoError(ZapmycoErrorCode.UNKNOWN, 'test');
    expect(err.context).toBeUndefined();
  });

  it('should be instanceof Error', () => {
    const err = new ZapmycoError(ZapmycoErrorCode.UNKNOWN, 'test');
    expect(err).toBeInstanceOf(Error);
  });

  it('should be instanceof ZapmycoError', () => {
    const err = new ZapmycoError(ZapmycoErrorCode.UNKNOWN, 'test');
    expect(err).toBeInstanceOf(ZapmycoError);
  });

  describe('toJSON()', () => {
    it('should return serializable object with all fields', () => {
      const err = new ZapmycoError(ZapmycoErrorCode.AGENT_NOT_FOUND, 'agent missing', {
        agentId: 'abc',
      });
      const json = err.toJSON();
      expect(json).toEqual({
        name: 'ZapmycoError',
        code: ZapmycoErrorCode.AGENT_NOT_FOUND,
        message: 'agent missing',
        context: { agentId: 'abc' },
        stack: expect.any(String),
      });
    });

    it('should include stack trace', () => {
      const err = new ZapmycoError(ZapmycoErrorCode.UNKNOWN, 'test');
      const json = err.toJSON();
      expect(typeof json.stack).toBe('string');
      expect((json.stack as string | undefined)?.length ?? 0).toBeGreaterThan(0);
    });

    it('should have undefined context when not provided', () => {
      const err = new ZapmycoError(ZapmycoErrorCode.UNKNOWN, 'test');
      const json = err.toJSON();
      expect(json.context).toBeUndefined();
    });
  });
});

describe('IntentError', () => {
  it('should create with INTENT_PARSE_FAILED', () => {
    const err = new IntentError(ZapmycoErrorCode.INTENT_PARSE_FAILED, 'parse failed');
    expect(err.name).toBe('IntentError');
    expect(err.code).toBe(ZapmycoErrorCode.INTENT_PARSE_FAILED);
    expect(err.message).toBe('parse failed');
  });

  it('should create with INTENT_LOW_CONFIDENCE', () => {
    const err = new IntentError(ZapmycoErrorCode.INTENT_LOW_CONFIDENCE, 'low confidence');
    expect(err.name).toBe('IntentError');
    expect(err.code).toBe(ZapmycoErrorCode.INTENT_LOW_CONFIDENCE);
  });

  it('should accept optional context', () => {
    const err = new IntentError(ZapmycoErrorCode.INTENT_PARSE_FAILED, 'fail', { input: 'foo' });
    expect(err.context).toEqual({ input: 'foo' });
  });

  it('should be instanceof ZapmycoError', () => {
    const err = new IntentError(ZapmycoErrorCode.INTENT_PARSE_FAILED, 'test');
    expect(err).toBeInstanceOf(ZapmycoError);
  });
});

describe('DecomposeError', () => {
  it('should create with DECOMPOSE_FAILED', () => {
    const err = new DecomposeError(ZapmycoErrorCode.DECOMPOSE_FAILED, 'decompose failed');
    expect(err.name).toBe('DecomposeError');
    expect(err.code).toBe(ZapmycoErrorCode.DECOMPOSE_FAILED);
  });

  it('should create with DECOMPOSE_INVALID_GRAPH', () => {
    const err = new DecomposeError(ZapmycoErrorCode.DECOMPOSE_INVALID_GRAPH, 'invalid graph');
    expect(err.code).toBe(ZapmycoErrorCode.DECOMPOSE_INVALID_GRAPH);
  });

  it('should accept context', () => {
    const err = new DecomposeError(ZapmycoErrorCode.DECOMPOSE_FAILED, 'fail', { taskId: 't1' });
    expect(err.context).toEqual({ taskId: 't1' });
  });

  it('should be instanceof ZapmycoError', () => {
    expect(new DecomposeError(ZapmycoErrorCode.DECOMPOSE_FAILED, 'test')).toBeInstanceOf(
      ZapmycoError
    );
  });
});

describe('SchedulerError', () => {
  it('should create with SCHEDULER_NO_AVAILABLE_AGENT', () => {
    const err = new SchedulerError(ZapmycoErrorCode.SCHEDULER_NO_AVAILABLE_AGENT, 'no agent');
    expect(err.name).toBe('SchedulerError');
    expect(err.code).toBe(ZapmycoErrorCode.SCHEDULER_NO_AVAILABLE_AGENT);
  });

  it('should create with SCHEDULER_CAPABILITY_MISMATCH', () => {
    const err = new SchedulerError(ZapmycoErrorCode.SCHEDULER_CAPABILITY_MISMATCH, 'mismatch');
    expect(err.code).toBe(ZapmycoErrorCode.SCHEDULER_CAPABILITY_MISMATCH);
  });

  it('should create with SCHEDULER_TASK_TIMEOUT', () => {
    const err = new SchedulerError(ZapmycoErrorCode.SCHEDULER_TASK_TIMEOUT, 'timeout');
    expect(err.code).toBe(ZapmycoErrorCode.SCHEDULER_TASK_TIMEOUT);
  });

  it('should accept context', () => {
    const err = new SchedulerError(ZapmycoErrorCode.SCHEDULER_TASK_TIMEOUT, 'timeout', {
      taskId: 't1',
      timeoutMs: 30000,
    });
    expect(err.context).toEqual({ taskId: 't1', timeoutMs: 30000 });
  });

  it('should be instanceof ZapmycoError', () => {
    expect(
      new SchedulerError(ZapmycoErrorCode.SCHEDULER_NO_AVAILABLE_AGENT, 'test')
    ).toBeInstanceOf(ZapmycoError);
  });
});

describe('AgentError', () => {
  it('should create with AGENT_NOT_FOUND', () => {
    const err = new AgentError(ZapmycoErrorCode.AGENT_NOT_FOUND, 'agent error');
    expect(err.name).toBe('AgentError');
    expect(err.code).toBe(ZapmycoErrorCode.AGENT_NOT_FOUND);
    expect(err.message).toBe('agent error');
  });

  it('should create with AGENT_OFFLINE', () => {
    const err = new AgentError(ZapmycoErrorCode.AGENT_OFFLINE, 'offline');
    expect(err.code).toBe(ZapmycoErrorCode.AGENT_OFFLINE);
  });

  it('should create with AGENT_EXECUTION_FAILED', () => {
    const err = new AgentError(ZapmycoErrorCode.AGENT_EXECUTION_FAILED, 'failed');
    expect(err.code).toBe(ZapmycoErrorCode.AGENT_EXECUTION_FAILED);
  });

  it('should create with AGENT_HEALTH_CHECK_FAILED', () => {
    const err = new AgentError(ZapmycoErrorCode.AGENT_HEALTH_CHECK_FAILED, 'health fail');
    expect(err.code).toBe(ZapmycoErrorCode.AGENT_HEALTH_CHECK_FAILED);
  });

  it('should accept context', () => {
    const err = new AgentError(ZapmycoErrorCode.AGENT_NOT_FOUND, 'not found', {
      agentId: 'missing',
    });
    expect(err.context).toEqual({ agentId: 'missing' });
  });

  it('should be instanceof ZapmycoError', () => {
    expect(new AgentError(ZapmycoErrorCode.AGENT_OFFLINE, 'test')).toBeInstanceOf(ZapmycoError);
  });
});

describe('LlmError', () => {
  it('should create with LLM_API_ERROR', () => {
    const err = new LlmError(ZapmycoErrorCode.LLM_API_ERROR, 'api error');
    expect(err.name).toBe('LlmError');
    expect(err.code).toBe(ZapmycoErrorCode.LLM_API_ERROR);
    expect(err.message).toBe('api error');
  });

  it('should create with LLM_RATE_LIMITED', () => {
    const err = new LlmError(ZapmycoErrorCode.LLM_RATE_LIMITED, 'rate limited');
    expect(err.code).toBe(ZapmycoErrorCode.LLM_RATE_LIMITED);
  });

  it('should create with LLM_QUOTA_EXCEEDED', () => {
    const err = new LlmError(ZapmycoErrorCode.LLM_QUOTA_EXCEEDED, 'quota exceeded');
    expect(err.code).toBe(ZapmycoErrorCode.LLM_QUOTA_EXCEEDED);
  });

  it('should accept context', () => {
    const err = new LlmError(ZapmycoErrorCode.LLM_API_ERROR, 'api error', {
      model: 'claude-sonnet',
    });
    expect(err.context).toEqual({ model: 'claude-sonnet' });
  });

  it('should be instanceof ZapmycoError', () => {
    expect(new LlmError(ZapmycoErrorCode.LLM_RATE_LIMITED, 'test')).toBeInstanceOf(ZapmycoError);
  });
});
