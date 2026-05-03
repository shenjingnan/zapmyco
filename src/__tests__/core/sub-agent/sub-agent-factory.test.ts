import { describe, expect, it } from 'vitest';
import { buildSubAgentSystemPrompt, DEFAULT_SAFE_TOOLS } from '@/core/sub-agent/sub-agent-factory';

describe('sub-agent-factory', () => {
  describe('DEFAULT_SAFE_TOOLS', () => {
    it('should include read-only and search tools', () => {
      expect(DEFAULT_SAFE_TOOLS).toContain('read_file');
      expect(DEFAULT_SAFE_TOOLS).toContain('glob');
      expect(DEFAULT_SAFE_TOOLS).toContain('grep');
      expect(DEFAULT_SAFE_TOOLS).toContain('web_fetch');
      expect(DEFAULT_SAFE_TOOLS).toContain('web_search');
      expect(DEFAULT_SAFE_TOOLS).toContain('get_current_time');
      expect(DEFAULT_SAFE_TOOLS).toContain('get_workdir_info');
    });

    it('should not include write or shell tools', () => {
      expect(DEFAULT_SAFE_TOOLS).not.toContain('write_file');
      expect(DEFAULT_SAFE_TOOLS).not.toContain('edit_file');
      expect(DEFAULT_SAFE_TOOLS).not.toContain('shell_exec');
      expect(DEFAULT_SAFE_TOOLS).not.toContain('shell_process');
    });

    it('should not include recursive tools', () => {
      expect(DEFAULT_SAFE_TOOLS).not.toContain('spawn_subagents');
      expect(DEFAULT_SAFE_TOOLS).not.toContain('memory');
      expect(DEFAULT_SAFE_TOOLS).not.toContain('Skill');
      expect(DEFAULT_SAFE_TOOLS).not.toContain('task_manage');
    });
  });

  describe('buildSubAgentSystemPrompt', () => {
    it('should include task description', () => {
      const spec = { id: 'test-1', description: '搜索 React 最新文档' };
      const prompt = buildSubAgentSystemPrompt(spec);

      expect(prompt).toContain('AI 子助手');
      expect(prompt).toContain('搜索 React 最新文档');
      expect(prompt).toContain('## 你的任务');
      expect(prompt).toContain('## 工作规则');
    });

    it('should include context when provided', () => {
      const spec = { id: 'test-1', description: '分析性能' };
      const context = '这是一个 Next.js 项目，需要优化首屏加载';
      const prompt = buildSubAgentSystemPrompt(spec, context);

      expect(prompt).toContain('## 背景上下文（来自父 Agent）');
      expect(prompt).toContain('Next.js 项目');
      expect(prompt).toContain('首屏加载');
    });

    it('should not include context section when context is undefined', () => {
      const spec = { id: 'test-1', description: '简单任务' };
      const prompt = buildSubAgentSystemPrompt(spec);

      expect(prompt).not.toContain('## 背景上下文');
    });

    it('should include working directory info', () => {
      const spec = { id: 'test-1', description: '任务' };
      const prompt = buildSubAgentSystemPrompt(spec);

      expect(prompt).toContain('工作目录');
    });

    it('should include behavior rules', () => {
      const spec = { id: 'test-1', description: '任务' };
      const prompt = buildSubAgentSystemPrompt(spec);

      expect(prompt).toContain('只执行分配给你的任务');
      expect(prompt).toContain('不要试图与其他 Agent 协调或通信');
      expect(prompt).toContain('不要在完成主任务后主动探索其他方向');
      expect(prompt).toContain('完成后直接输出你的结论');
    });
  });
});
