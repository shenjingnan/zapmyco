import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock 所有工具工厂模块
vi.mock('@/cli/repl/tools/file-write', () => ({
  createWriteFileTool: vi.fn(() => ({
    id: 'WriteFile',
    label: '写入文件',
    description: '写入文件描述',
    execute: vi.fn(),
  })),
}));

vi.mock('@/cli/repl/tools/file-edit', () => ({
  createEditFileTool: vi.fn(() => ({
    id: 'EditFile',
    label: '编辑文件',
    description: '编辑文件描述',
    execute: vi.fn(),
  })),
}));

vi.mock('@/cli/repl/tools/file-glob', () => ({
  createGlobTool: vi.fn(() => ({
    id: 'Glob',
    label: '文件搜索',
    description: '文件搜索描述',
    execute: vi.fn(),
  })),
}));

vi.mock('@/cli/repl/tools/file-grep', () => ({
  createGrepTool: vi.fn(() => ({
    id: 'Grep',
    label: '内容搜索',
    description: '内容搜索描述',
    execute: vi.fn(),
  })),
}));

vi.mock('@/cli/repl/tools/shell-exec', () => ({
  createExecTool: vi.fn(() => ({
    id: 'Exec',
    label: '执行命令',
    description: '执行命令描述',
    execute: vi.fn(),
  })),
}));

vi.mock('@/cli/repl/tools/shell-process', () => ({
  createProcessTool: vi.fn(() => ({
    id: 'Process',
    label: '管理进程',
    description: '管理进程描述',
    execute: vi.fn(),
  })),
}));

vi.mock('@/cli/repl/tools/memory-tool', () => ({
  createMemoryTool: vi.fn(() => ({
    id: 'Memory',
    label: '记忆管理',
    description: '记忆管理描述',
    execute: vi.fn(),
  })),
}));

vi.mock('@/cli/repl/tools/web-fetch', () => ({
  createWebFetchTool: vi.fn(() => ({
    id: 'WebFetch',
    label: '网页抓取',
    description: '网页抓取描述',
    execute: vi.fn(),
  })),
}));

vi.mock('@/cli/repl/tools/web-search', () => ({
  createWebSearchTool: vi.fn(() => ({
    id: 'WebSearch',
    label: '网页搜索',
    description: '网页搜索描述',
    execute: vi.fn(),
  })),
}));

vi.mock('@/cli/repl/tools/task-manage', () => ({
  createTaskManageTool: vi.fn(() => ({
    id: 'TaskManage',
    label: '任务管理',
    description: '任务管理描述',
    execute: vi.fn(),
  })),
}));

vi.mock('@/cli/repl/tools/skill-tool', () => ({
  createSkillTool: vi.fn(() => ({
    id: 'Skill',
    label: '技能',
    description: '技能描述',
    execute: vi.fn(),
  })),
}));

vi.mock('@/cli/repl/tools/subagent-spawn', () => ({
  createSpawnSubAgentsTool: vi.fn(() => ({
    id: 'SpawnSubAgents',
    label: '派生子 Agent',
    description: '派生子 Agent 描述',
    execute: vi.fn(),
  })),
}));

vi.mock('@/cli/repl/tools/cron-tool', () => ({
  createCronTool: vi.fn(() => ({
    id: 'ScheduledTask',
    label: '定时任务',
    description: '定时任务描述',
    execute: vi.fn(),
  })),
}));

vi.mock('@/cli/repl/cron/cron-scheduler', () => ({
  CronScheduler: vi.fn(),
}));

vi.mock('@/core/sub-agent', () => ({
  SubAgentManager: vi.fn(),
}));

vi.mock('@/core/agent-team/agent-orchestrator', () => ({
  AgentOrchestrator: vi.fn().mockImplementation(() => ({
    spawnWorker: vi.fn(),
    spawnTeam: vi.fn(),
    spawnFlat: vi.fn(),
  })),
}));

vi.mock('@/core/agent-team/agent-background-manager', () => ({
  getBackgroundAgentManager: vi.fn(() => ({
    setOrchestrator: vi.fn(),
    restore: vi.fn(),
  })),
}));

vi.mock('@/cli/repl/tools/agent-tool', () => ({
  createAgentTool: vi.fn(() => ({
    id: 'AgentTool',
    label: '创建 Agent',
    description: '创建子 Agent 描述',
    execute: vi.fn(),
  })),
}));

vi.mock('@/cli/repl/tools/file-security', () => ({
  readStateTracker: { recordRead: vi.fn() },
}));

import { createReplBuiltinTools } from '@/cli/repl/repl-agent-tools';
import type { SkillConfig, SubAgentConfig, WebConfig } from '@/config/types';
import type { TaskStore } from '@/core/task/task-store';

function textOf(result: { content?: Array<{ text?: string }> }): string {
  return result?.content?.[0]?.text ?? '';
}

function makeSubAgentConfig(overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
  return {
    enabled: true,
    maxConcurrent: 3,
    taskTimeoutMs: 60000,
    maxOutputChars: 20000,
    maxTurns: 10,
    allowRecursiveSpawn: false,
    ...overrides,
  };
}

describe('createReplBuiltinTools', () => {
  // ============ 内置基础工具定义 ============

  describe('内置基础工具定义', () => {
    it('应包含 GetCurrentTime 工具及正确 id', () => {
      const tools = createReplBuiltinTools();
      const tool = tools.find((t) => t.id === 'GetCurrentTime');
      expect(tool).toBeDefined();
      expect(tool?.label).toBe('获取当前时间');
    });

    it('应包含 GetWorkdirInfo 工具及正确 id', () => {
      const tools = createReplBuiltinTools();
      const tool = tools.find((t) => t.id === 'GetWorkdirInfo');
      expect(tool).toBeDefined();
      expect(tool?.label).toBe('获取工作目录信息');
    });

    it('应包含 ReadFile 工具及正确 id', () => {
      const tools = createReplBuiltinTools();
      const tool = tools.find((t) => t.id === 'ReadFile');
      expect(tool).toBeDefined();
      expect(tool?.label).toBe('读取文件');
      expect(tool?.parameters).toBeDefined();
    });
  });

  // ============ GetCurrentTime.execute ============

  describe('GetCurrentTime.execute', () => {
    it('应返回本地时间、ISO 时间和时区', async () => {
      const tools = createReplBuiltinTools();
      const tool = tools.find((t) => t.id === 'GetCurrentTime');
      const result = await (tool as any).execute('test', {});
      const text = textOf(result);
      expect(text).toContain('本地时间:');
      expect(text).toContain('ISO (UTC):');
      expect(text).toContain('时区:');
    });

    it('details 应包含 timestamp 和 timezone', async () => {
      const tools = createReplBuiltinTools();
      const tool = tools.find((t) => t.id === 'GetCurrentTime');
      const result = await (tool as any).execute('test', {});
      expect((result as any).details.timestamp).toBeTypeOf('number');
      expect((result as any).details.timezone).toBeTypeOf('string');
    });
  });

  // ============ GetWorkdirInfo.execute ============

  describe('GetWorkdirInfo.execute', () => {
    it('应返回包含 cwd 的 JSON', async () => {
      const tools = createReplBuiltinTools();
      const tool = tools.find((t) => t.id === 'GetWorkdirInfo');
      const result = await (tool as any).execute('test', {});
      const parsed = JSON.parse(textOf(result));
      expect(parsed.cwd).toBe(process.cwd());
    });

    it('应返回 platform、arch、nodeVersion', async () => {
      const tools = createReplBuiltinTools();
      const tool = tools.find((t) => t.id === 'GetWorkdirInfo');
      const result = await (tool as any).execute('test', {});
      const parsed = JSON.parse(textOf(result));
      expect(parsed.platform).toBe(process.platform);
      expect(parsed.arch).toBe(process.arch);
      expect(parsed.nodeVersion).toBe(process.version);
    });

    it('details 应包含 cwd 和 platform', async () => {
      const tools = createReplBuiltinTools();
      const tool = tools.find((t) => t.id === 'GetWorkdirInfo');
      const result = await (tool as any).execute('test', {});
      expect((result as any).details.cwd).toBe(process.cwd());
      expect((result as any).details.platform).toBe(process.platform);
    });
  });

  // ============ ReadFile.execute ============

  describe('ReadFile.execute', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'zapmyco-readfile-'));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('应读取文件内容', async () => {
      const filePath = join(tmpDir, 'test.txt');
      writeFileSync(filePath, 'Hello World\nLine 2\n');

      const tools = createReplBuiltinTools();
      const tool = tools.find((t) => t.id === 'ReadFile');
      const result = await (tool as any).execute('test', { file_path: filePath });
      const text = textOf(result);
      expect(text).toContain('Hello World');
      expect(text).toContain('Line 2');
      expect((result as any).details.path).toBe(filePath);
    });

    it('支持 offset 和 limit 分页', async () => {
      const filePath = join(tmpDir, 'multiline.txt');
      const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`);
      writeFileSync(filePath, lines.join('\n'));

      const tools = createReplBuiltinTools();
      const tool = tools.find((t) => t.id === 'ReadFile');
      const result = await (tool as any).execute('test', {
        file_path: filePath,
        offset: 5,
        limit: 3,
      });
      const text = textOf(result);
      expect(text).toContain('Line 5');
      expect(text).toContain('Line 7');
      expect((result as any).details.offset).toBe(5);
      expect((result as any).details.limit).toBe(3);
      expect((result as any).details.truncated).toBe(true);
    });

    it('文件不存在时应返回错误', async () => {
      const tools = createReplBuiltinTools();
      const tool = tools.find((t) => t.id === 'ReadFile');
      const result = await (tool as any).execute('test', { file_path: '/nonexistent/path.txt' });
      expect(textOf(result)).toContain('读取失败');
      expect((result as any).details.error).toBe(true);
    });
  });

  // ============ 始终包含的工具 ============

  describe('始终包含的工具', () => {
    it('应包含 WriteFile', () => {
      const tools = createReplBuiltinTools();
      expect(tools.some((t) => t.id === 'WriteFile')).toBe(true);
    });

    it('应包含 EditFile', () => {
      const tools = createReplBuiltinTools();
      expect(tools.some((t) => t.id === 'EditFile')).toBe(true);
    });

    it('应包含 Glob', () => {
      const tools = createReplBuiltinTools();
      expect(tools.some((t) => t.id === 'Glob')).toBe(true);
    });

    it('应包含 Grep', () => {
      const tools = createReplBuiltinTools();
      expect(tools.some((t) => t.id === 'Grep')).toBe(true);
    });

    it('应包含 Exec', () => {
      const tools = createReplBuiltinTools();
      expect(tools.some((t) => t.id === 'Exec')).toBe(true);
    });

    it('应包含 Process', () => {
      const tools = createReplBuiltinTools();
      expect(tools.some((t) => t.id === 'Process')).toBe(true);
    });

    it('应包含 Memory', () => {
      const tools = createReplBuiltinTools();
      expect(tools.some((t) => t.id === 'Memory')).toBe(true);
    });

    it('应包含至少 10 个基础工具（3 内置 + 7 始终）', () => {
      const tools = createReplBuiltinTools({ enabled: false } as WebConfig);
      expect(tools.length).toBeGreaterThanOrEqual(10);
    });
  });

  // ============ 条件分支: Web 工具 ============

  describe('Web 工具条件分支', () => {
    it('webConfig 未传时应默认包含 WebFetch 和 WebSearch', () => {
      const tools = createReplBuiltinTools();
      expect(tools.some((t) => t.id === 'WebFetch')).toBe(true);
      expect(tools.some((t) => t.id === 'WebSearch')).toBe(true);
    });

    it('webConfig.enabled=false 时应排除 WebFetch 和 WebSearch', () => {
      const tools = createReplBuiltinTools({ enabled: false } as WebConfig);
      expect(tools.some((t) => t.id === 'WebFetch')).toBe(false);
      expect(tools.some((t) => t.id === 'WebSearch')).toBe(false);
    });

    it('webConfig.enabled=true 时应包含 WebFetch 和 WebSearch', () => {
      const tools = createReplBuiltinTools({ enabled: true } as WebConfig);
      expect(tools.some((t) => t.id === 'WebFetch')).toBe(true);
      expect(tools.some((t) => t.id === 'WebSearch')).toBe(true);
    });
  });

  // ============ 条件分支: Task 工具 ============

  describe('Task 工具条件分支', () => {
    it('传入 taskStore 时应包含 TaskManage', () => {
      const mockStore = {} as TaskStore;
      const tools = createReplBuiltinTools(undefined, mockStore);
      expect(tools.some((t) => t.id === 'TaskManage')).toBe(true);
    });

    it('未传 taskStore 时应排除 TaskManage', () => {
      const tools = createReplBuiltinTools();
      expect(tools.some((t) => t.id === 'TaskManage')).toBe(false);
    });
  });

  // ============ 条件分支: Skill 工具 ============

  describe('Skill 工具条件分支', () => {
    it('skillConfig 未传时应默认包含 Skill', () => {
      const tools = createReplBuiltinTools();
      expect(tools.some((t) => t.id === 'Skill')).toBe(true);
    });

    it('skillConfig.enabled=false 时应排除 Skill', () => {
      const tools = createReplBuiltinTools(undefined, undefined, {
        enabled: false,
      } as SkillConfig);
      expect(tools.some((t) => t.id === 'Skill')).toBe(false);
    });
  });

  // ============ 条件分支: Sub-Agent 工具 ============

  describe('Sub-Agent 工具条件分支', () => {
    it('传入 parentAgent 和 subAgentConfig 时应包含 SpawnSubAgents', () => {
      const mockAgent = { id: 'parent' } as any;
      const config = makeSubAgentConfig({ enabled: true });
      const tools = createReplBuiltinTools(undefined, undefined, undefined, mockAgent, config);
      expect(tools.some((t) => t.id === 'SpawnSubAgents')).toBe(true);
    });

    it('subAgentConfig.enabled=false 时应排除 SpawnSubAgents', () => {
      const mockAgent = { id: 'parent' } as any;
      const config = makeSubAgentConfig({ enabled: false });
      const tools = createReplBuiltinTools(undefined, undefined, undefined, mockAgent, config);
      expect(tools.some((t) => t.id === 'SpawnSubAgents')).toBe(false);
    });

    it('未传 parentAgent 时应排除 SpawnSubAgents', () => {
      const config = makeSubAgentConfig({ enabled: true });
      const tools = createReplBuiltinTools(undefined, undefined, undefined, undefined, config);
      expect(tools.some((t) => t.id === 'SpawnSubAgents')).toBe(false);
    });

    it('agentTeam.enabled 时应包含 AgentTool 而非 SpawnSubAgents', () => {
      const mockAgent = { id: 'parent' } as any;
      const config = makeSubAgentConfig({ enabled: true });
      const teamConfig = {
        enabled: true,
        defaultMode: 'flat' as const,
        maxGlobalDepth: 2,
        messageTimeoutMs: 60000,
        maxAggregateOutputChars: 20000,
      };
      const tools = createReplBuiltinTools(
        undefined,
        undefined,
        undefined,
        mockAgent,
        config,
        undefined,
        teamConfig
      );
      expect(tools.some((t) => t.id === 'AgentTool')).toBe(true);
      expect(tools.some((t) => t.id === 'SpawnSubAgents')).toBe(false);
    });

    it('agentTeam.enabled 时应包含 AgentTool 而非 SpawnSubAgents（coordinator 模式）', () => {
      const mockAgent = { id: 'parent' } as any;
      const config = makeSubAgentConfig({ enabled: true });
      const teamConfig = {
        enabled: true,
        defaultMode: 'coordinator' as const,
        maxGlobalDepth: 2,
        messageTimeoutMs: 60000,
        maxAggregateOutputChars: 20000,
      };
      const tools = createReplBuiltinTools(
        undefined,
        undefined,
        undefined,
        mockAgent,
        config,
        undefined,
        teamConfig
      );
      expect(tools.some((t) => t.id === 'AgentTool')).toBe(true);
      expect(tools.some((t) => t.id === 'SpawnSubAgents')).toBe(false);
    });
  });

  // ============ 条件分支: Cron 工具 ============

  describe('Cron 工具条件分支', () => {
    it('传入 cronScheduler 时应包含 ScheduledTask', () => {
      const mockScheduler = {} as any;
      const tools = createReplBuiltinTools(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mockScheduler
      );
      expect(tools.some((t) => t.id === 'ScheduledTask')).toBe(true);
    });

    it('未传 cronScheduler 时应排除 ScheduledTask', () => {
      const tools = createReplBuiltinTools();
      expect(tools.some((t) => t.id === 'ScheduledTask')).toBe(false);
    });
  });

  // ============ 全量工具组合 ============

  describe('全量工具组合', () => {
    it('传入所有可选参数时应返回完整工具集', () => {
      const mockStore = {} as TaskStore;
      const mockAgent = { id: 'parent' } as any;
      const config = makeSubAgentConfig({ enabled: true });
      const mockScheduler = {} as any;

      const tools = createReplBuiltinTools(
        { enabled: true } as WebConfig,
        mockStore,
        { enabled: true } as SkillConfig,
        mockAgent,
        config,
        mockScheduler
      );

      const ids = tools.map((t) => t.id);
      expect(ids).toContain('GetCurrentTime');
      expect(ids).toContain('GetWorkdirInfo');
      expect(ids).toContain('ReadFile');
      expect(ids).toContain('WriteFile');
      expect(ids).toContain('EditFile');
      expect(ids).toContain('Glob');
      expect(ids).toContain('Grep');
      expect(ids).toContain('Exec');
      expect(ids).toContain('Process');
      expect(ids).toContain('Memory');
      expect(ids).toContain('WebFetch');
      expect(ids).toContain('WebSearch');
      expect(ids).toContain('TaskManage');
      expect(ids).toContain('Skill');
      expect(ids).toContain('SpawnSubAgents');
      expect(ids).toContain('ScheduledTask');
    });
  });
});
