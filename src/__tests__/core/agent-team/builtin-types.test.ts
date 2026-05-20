import { describe, expect, it } from 'vitest';
import {
  BUILTIN_AGENT_TYPES,
  coderType,
  coordinatorType,
  generalPurposeType,
  plannerType,
  researcherType,
  reviewerType,
} from '@/core/agent-team/builtin-types';

describe('builtin agent types', () => {
  describe('BUILTIN_AGENT_TYPES', () => {
    it('should contain 6 types', () => {
      expect(BUILTIN_AGENT_TYPES).toHaveLength(6);
    });

    it('should have unique typeIds', () => {
      const ids = BUILTIN_AGENT_TYPES.map((t) => t.typeId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('should all have source "builtin"', () => {
      for (const t of BUILTIN_AGENT_TYPES) {
        expect(t.source).toBe('builtin');
      }
    });

    it('should all have non-empty whenToUse', () => {
      for (const t of BUILTIN_AGENT_TYPES) {
        expect(t.whenToUse.length).toBeGreaterThan(0);
      }
    });
  });

  describe('coordinator', () => {
    it('should be a coordinator role', () => {
      expect(coordinatorType.typeId).toBe('coordinator');
      expect(coordinatorType.role).toBe('coordinator');
    });

    it('should have full tool policy (coordinator filter applied by factory)', () => {
      expect(coordinatorType.toolPolicy).toEqual({ mode: 'full' });
    });

    it('should be able to spawn two levels', () => {
      expect(coordinatorType.maxSpawnDepth).toBe(2);
    });

    it('should have orchestration capabilities', () => {
      const capIds = coordinatorType.capabilities.map((c) => c.id);
      expect(capIds).toContain('task-decomposition');
      expect(capIds).toContain('agent-orchestration');
      expect(capIds).toContain('result-synthesis');
      expect(capIds).toContain('team-coordination');
    });

    it('should have inherit permission mode', () => {
      expect(coordinatorType.permissionMode).toBe('inherit');
    });

    it('should generate system prompt with orchestration focus', () => {
      const prompt = coordinatorType.getSystemPrompt({
        taskDescription: 'Build a full-stack app',
        workdir: '/project',
      });
      expect(prompt).toContain('协调者');
      expect(prompt).toContain('Build a full-stack app');
      expect(prompt).toContain('AgentTool');
      expect(prompt).toContain('researcher');
      expect(prompt).toContain('coder');
      expect(prompt).toContain('不亲自执行');
    });

    it('should include context when provided', () => {
      const prompt = coordinatorType.getSystemPrompt({
        taskDescription: 'Orchestrate task',
        workdir: '/tmp',
        context: 'Project uses React + Node.js',
      });
      expect(prompt).toContain('Project uses React + Node.js');
    });

    it('should be the first type in BUILTIN_AGENT_TYPES', () => {
      expect(BUILTIN_AGENT_TYPES[0]?.typeId).toBe('coordinator');
    });
  });

  describe('researcher', () => {
    it('should be a worker with safe tool policy', () => {
      expect(researcherType.typeId).toBe('researcher');
      expect(researcherType.role).toBe('worker');
      expect(researcherType.toolPolicy).toEqual({ mode: 'safe' });
    });

    it('should not be able to spawn', () => {
      expect(researcherType.maxSpawnDepth).toBe(0);
    });

    it('should have research and analysis capabilities', () => {
      const capIds = researcherType.capabilities.map((c) => c.id);
      expect(capIds).toContain('web-research');
      expect(capIds).toContain('code-analysis');
    });

    it('should have restricted permission mode', () => {
      expect(researcherType.permissionMode).toBe('restricted');
    });

    it('should generate system prompt with task description', () => {
      const prompt = researcherType.getSystemPrompt({
        taskDescription: 'Search for React patterns',
        workdir: '/project',
      });
      expect(prompt).toContain('AI 研究员');
      expect(prompt).toContain('Search for React patterns');
      expect(prompt).toContain('/project');
    });

    it('should include context when provided', () => {
      const prompt = researcherType.getSystemPrompt({
        taskDescription: 'Research task',
        workdir: '/tmp',
        context: 'Background info here',
      });
      expect(prompt).toContain('Background info here');
    });

    it('should include upstream results when provided', () => {
      const prompt = researcherType.getSystemPrompt({
        taskDescription: 'Research task',
        workdir: '/tmp',
        upstreamResults: ['Result A', 'Result B'],
      });
      expect(prompt).toContain('Result A');
      expect(prompt).toContain('Result B');
    });
  });

  describe('coder', () => {
    it('should be a worker with standard tool policy', () => {
      expect(coderType.typeId).toBe('coder');
      expect(coderType.role).toBe('worker');
      expect(coderType.toolPolicy).toEqual({ mode: 'standard' });
    });

    it('should not be able to spawn', () => {
      expect(coderType.maxSpawnDepth).toBe(0);
    });

    it('should have bubble permission mode', () => {
      expect(coderType.permissionMode).toBe('bubble');
    });

    it('should have code generation and modification capabilities', () => {
      const capIds = coderType.capabilities.map((c) => c.id);
      expect(capIds).toContain('code-generation');
      expect(capIds).toContain('code-modification');
    });

    it('should generate system prompt with implementation focus', () => {
      const prompt = coderType.getSystemPrompt({
        taskDescription: 'Implement login',
        workdir: '/project',
      });
      expect(prompt).toContain('AI 编码助手');
      expect(prompt).toContain('Implement login');
      expect(prompt).toContain('先读后写');
    });
  });

  describe('reviewer', () => {
    it('should be a worker with safe tool policy', () => {
      expect(reviewerType.typeId).toBe('reviewer');
      expect(reviewerType.role).toBe('worker');
      expect(reviewerType.toolPolicy).toEqual({ mode: 'safe' });
    });

    it('should not be able to spawn', () => {
      expect(reviewerType.maxSpawnDepth).toBe(0);
    });

    it('should have review and security capabilities', () => {
      const capIds = reviewerType.capabilities.map((c) => c.id);
      expect(capIds).toContain('code-review');
      expect(capIds).toContain('security-scan');
    });

    it('should have restricted permission mode', () => {
      expect(reviewerType.permissionMode).toBe('restricted');
    });

    it('should include review checklist in prompt', () => {
      const prompt = reviewerType.getSystemPrompt({
        taskDescription: 'Review auth module',
        workdir: '/project',
      });
      expect(prompt).toContain('审查员');
      expect(prompt).toContain('审查清单');
      expect(prompt).toContain('类型安全');
      expect(prompt).toContain('错误处理');
    });
  });

  describe('planner', () => {
    it('should be a worker with standard tool policy', () => {
      expect(plannerType.typeId).toBe('planner');
      expect(plannerType.role).toBe('worker');
      expect(plannerType.toolPolicy).toEqual({ mode: 'standard' });
    });

    it('should be able to spawn one level', () => {
      expect(plannerType.maxSpawnDepth).toBe(1);
    });

    it('should have planning capabilities', () => {
      const capIds = plannerType.capabilities.map((c) => c.id);
      expect(capIds).toContain('planning');
      expect(capIds).toContain('architecture-design');
      expect(capIds).toContain('task-decomposition');
    });

    it('should include work flow steps in prompt', () => {
      const prompt = plannerType.getSystemPrompt({
        taskDescription: 'Design auth system',
        workdir: '/project',
      });
      expect(prompt).toContain('规划师');
      expect(prompt).toContain('理解需求');
      expect(prompt).toContain('现状分析');
      expect(prompt).toContain('方案设计');
    });

    it('should include context when provided', () => {
      const prompt = plannerType.getSystemPrompt({
        taskDescription: 'Design auth system',
        workdir: '/project',
        context: 'Using TypeScript and Node.js 22',
      });
      expect(prompt).toContain('Using TypeScript and Node.js 22');
    });
  });

  describe('general-purpose', () => {
    it('should be universal role', () => {
      expect(generalPurposeType.typeId).toBe('general-purpose');
      expect(generalPurposeType.role).toBe('universal');
    });

    it('should have standard tool policy', () => {
      expect(generalPurposeType.toolPolicy).toEqual({ mode: 'standard' });
    });

    it('should be able to spawn one level', () => {
      expect(generalPurposeType.maxSpawnDepth).toBe(1);
    });

    it('should have inherit permission mode', () => {
      expect(generalPurposeType.permissionMode).toBe('inherit');
    });

    it('should generate concise prompt', () => {
      const prompt = generalPurposeType.getSystemPrompt({
        taskDescription: 'Generic task',
        workdir: '/project',
      });
      expect(prompt).toContain('AI 子助手');
      expect(prompt).toContain('Generic task');
      expect(prompt).toContain('专注任务');
    });

    it('should be the last type in BUILTIN_AGENT_TYPES (default fallback)', () => {
      expect(BUILTIN_AGENT_TYPES.at(-1)?.typeId).toBe('general-purpose');
    });
  });

  describe('reviewer', () => {
    it('should be a worker with safe tool policy', () => {
      expect(reviewerType.typeId).toBe('reviewer');
      expect(reviewerType.role).toBe('worker');
      expect(reviewerType.toolPolicy).toEqual({ mode: 'safe' });
    });

    it('should have restricted permission mode', () => {
      expect(reviewerType.permissionMode).toBe('restricted');
    });

    it('should include context when provided', () => {
      const prompt = reviewerType.getSystemPrompt({
        taskDescription: 'Review code quality',
        workdir: '/project',
        context: 'Code review for auth module',
      });
      expect(prompt).toContain('Code review for auth module');
    });
  });

  describe('builtin type color uniqueness', () => {
    it('each type should have a defined color', () => {
      for (const t of BUILTIN_AGENT_TYPES) {
        expect(t.color).toBeDefined();
        expect(t.color?.length).toBeGreaterThan(0);
      }
    });
  });

  describe('builtin type maxTurns', () => {
    it('should all have positive maxTurns', () => {
      for (const t of BUILTIN_AGENT_TYPES) {
        expect(t.maxTurns).toBeGreaterThan(0);
      }
    });
  });
});
