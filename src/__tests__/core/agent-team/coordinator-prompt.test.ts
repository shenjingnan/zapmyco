import { describe, expect, it } from 'vitest';
import { getMainCoordinatorSystemPrompt } from '@/core/agent-team/coordinator-prompt';

describe('getMainCoordinatorSystemPrompt', () => {
  it('should include core principles section', () => {
    const prompt = getMainCoordinatorSystemPrompt('/test/workdir');
    expect(prompt).toContain('核心原则');
    expect(prompt).toContain('绝对不能直接执行任何具体工作');
  });

  it('should include core responsibilities section', () => {
    const prompt = getMainCoordinatorSystemPrompt('/test/workdir');
    expect(prompt).toContain('核心职责');
    expect(prompt).toContain('分析用户任务');
    expect(prompt).toContain('拆解');
    expect(prompt).toContain('匹配');
  });

  it('should list available agent types', () => {
    const prompt = getMainCoordinatorSystemPrompt('/test/workdir');
    expect(prompt).toContain('researcher');
    expect(prompt).toContain('coder');
    expect(prompt).toContain('reviewer');
    expect(prompt).toContain('planner');
    expect(prompt).toContain('general-purpose');
  });

  it('should list available tools', () => {
    const prompt = getMainCoordinatorSystemPrompt('/test/workdir');
    expect(prompt).toContain('AgentTool');
    expect(prompt).toContain('SendMessage');
    expect(prompt).toContain('TaskStop');
  });

  it('should include work directory', () => {
    const prompt = getMainCoordinatorSystemPrompt('/custom/workdir/path');
    expect(prompt).toContain('/custom/workdir/path');
  });

  it('should include workflow steps', () => {
    const prompt = getMainCoordinatorSystemPrompt('/test/workdir');
    expect(prompt).toContain('工作流程');
    expect(prompt).toContain('分析任务');
    expect(prompt).toContain('拆解子任务');
    expect(prompt).toContain('派发执行');
    expect(prompt).toContain('汇总结果');
  });

  it('should include work rules', () => {
    const prompt = getMainCoordinatorSystemPrompt('/test/workdir');
    expect(prompt).toContain('工作规则');
    expect(prompt).toContain('绝不亲自执行');
    expect(prompt).toContain('并行优先');
    expect(prompt).toContain('先规划后执行');
  });

  it('should include the closing reminder', () => {
    const prompt = getMainCoordinatorSystemPrompt('/test/workdir');
    expect(prompt).toContain('你是协调者，不是执行者');
  });

  it('should mention restricted tools that coordinator must not use', () => {
    const prompt = getMainCoordinatorSystemPrompt('/test/workdir');
    expect(prompt).toContain('ReadFile');
    expect(prompt).toContain('WriteFile');
    expect(prompt).toContain('Exec');
  });

  it('should mention sync and async mode for AgentTool', () => {
    const prompt = getMainCoordinatorSystemPrompt('/test/workdir');
    expect(prompt).toContain('同步模式');
    expect(prompt).toContain('异步模式');
    expect(prompt).toContain('run_in_background');
  });

  it('should mention background task notification handling', () => {
    const prompt = getMainCoordinatorSystemPrompt('/test/workdir');
    expect(prompt).toContain('后台任务');
    expect(prompt).toContain('自动通知');
  });
});
