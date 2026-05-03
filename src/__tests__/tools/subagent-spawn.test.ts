import { describe, expect, it, vi } from 'vitest';
import { createSpawnSubAgentsTool } from '@/cli/repl/tools/subagent-spawn';
import type { SubAgentConfig } from '@/config/types';
import type { SubAgentManager } from '@/core/sub-agent/sub-agent-manager';
import type { SubAgentResults } from '@/core/sub-agent/types';

function createMockManager(returnResults?: SubAgentResults): SubAgentManager {
  return {
    spawnAndWait: vi.fn().mockResolvedValue(
      returnResults ?? {
        total: 2,
        succeeded: 2,
        failed: 0,
        results: [
          { specId: 'task-1', status: 'success', output: '结果1', duration: 1000 },
          { specId: 'task-2', status: 'success', output: '结果2', duration: 2000 },
        ],
        summary: '## 子任务执行汇总\n\n所有任务完成',
      }
    ),
  } as unknown as SubAgentManager;
}

const defaultConfig: SubAgentConfig = {
  enabled: true,
  maxConcurrent: 5,
  taskTimeoutMs: 300_000,
  maxOutputChars: 5000,
  maxTurns: 30,
  allowRecursiveSpawn: false,
};

describe('createSpawnSubAgentsTool', () => {
  describe('tool registration', () => {
    it('should register with correct id and label', () => {
      const manager = createMockManager();
      const tool = createSpawnSubAgentsTool(manager, defaultConfig);

      expect(tool.id).toBe('spawn_subagents');
      expect(tool.label).toBe('派生子 Agent');
    });

    it('should have a detailed description', () => {
      const manager = createMockManager();
      const tool = createSpawnSubAgentsTool(manager, defaultConfig);

      expect(tool.description).toContain('并行启动多个子 Agent');
      expect(tool.description).toContain('何时使用此工具');
      expect(tool.description).toContain('task_manage');
    });

    it('should define parameters schema with required agents array', () => {
      const manager = createMockManager();
      const tool = createSpawnSubAgentsTool(manager, defaultConfig);

      expect(tool.parameters).toBeDefined();
      const params = tool.parameters as Record<string, unknown>;
      expect(params.type).toBe('object');

      const properties = params.properties as Record<string, unknown>;
      expect(properties.agents).toBeDefined();

      const required = params.required as string[];
      expect(required).toContain('agents');
    });
  });

  describe('execute', () => {
    it('should call manager.spawnAndWait with agents and context', async () => {
      const manager = createMockManager();
      const tool = createSpawnSubAgentsTool(manager, defaultConfig);

      const agents = [
        { id: 'a', description: '任务A' },
        { id: 'b', description: '任务B' },
      ];
      const context = '项目背景';

      const result = await tool.execute('tc-1', { agents, context });

      expect(manager.spawnAndWait).toHaveBeenCalledWith(agents, context);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      const textContent = result.content[0] as { type: 'text'; text: string };
      expect(textContent.text).toContain('子任务执行汇总');
    });

    it('should call manager.spawnAndWait without context when omitted', async () => {
      const manager = createMockManager();
      const tool = createSpawnSubAgentsTool(manager, defaultConfig);

      const agents = [{ id: 'a', description: '任务A' }];

      await tool.execute('tc-1', { agents });

      expect(manager.spawnAndWait).toHaveBeenCalledWith(agents, undefined);
    });

    it('should return details in the result', async () => {
      const expectedResults: SubAgentResults = {
        total: 1,
        succeeded: 1,
        failed: 0,
        results: [{ specId: 'x', status: 'success', output: 'done', duration: 500 }],
        summary: 'summary text',
      };
      const manager = createMockManager(expectedResults);
      const tool = createSpawnSubAgentsTool(manager, defaultConfig);

      const result = await tool.execute('tc-1', {
        agents: [{ id: 'x', description: 'task' }],
      });

      expect(result.details).toEqual(expectedResults);
    });
  });
});
