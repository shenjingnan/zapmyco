import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLlmBasedAgent, type LlmBasedAgent } from '@/core/agent-runtime/agent-adapter';
import type { ToolRegistration } from '@/core/agent-runtime/tool-bridge';
import { createAgentFromType } from '@/core/agent-team/agent-factory';
import type { AgentTeamConfig, AgentTypeDefinition } from '@/core/agent-team/types';
import { AGENT_SAFE_TOOLS } from '@/core/agent-team/types';

// Mock pi-agent-core
vi.mock('@mariozechner/pi-agent-core', () => ({
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

/**
 * 从 LlmBasedAgent 的 inner state.tools 提取工具名称列表。
 * pi-agent-core 的 AgentTool 具有 name 属性，mock 中的类型推断有效。
 */
function getToolNames(agent: LlmBasedAgent): string[] {
  return agent.innerAgent.state.tools.map((t: { name: string }) => t.name);
}

function makeToolReg(id: string): ToolRegistration {
  return {
    id,
    label: id,
    description: `Tool ${id}`,
    execute: vi.fn(),
  };
}

function makeAvailableTools(): ToolRegistration[] {
  return [
    ...AGENT_SAFE_TOOLS.map(makeToolReg),
    makeToolReg('WriteFile'),
    makeToolReg('EditFile'),
    makeToolReg('Exec'),
    makeToolReg('Process'),
    makeToolReg('TaskManage'),
    makeToolReg('Memory'),
    makeToolReg('Skill'),
    makeToolReg('AgentTool'),
    makeToolReg('SpawnSubAgents'),
    makeToolReg('SendMessage'),
    makeToolReg('TaskStop'),
  ];
}

function makeConfig(overrides: Partial<AgentTeamConfig> = {}): AgentTeamConfig {
  return {
    enabled: true,
    defaultMode: 'coordinator',
    maxGlobalDepth: 2,
    messageTimeoutMs: 60_000,
    maxAggregateOutputChars: 10_000,
    agentTypes: [],
    ...overrides,
  };
}

function createParentAgent(): LlmBasedAgent {
  return createLlmBasedAgent({
    agentId: 'parent-agent',
    displayName: 'Parent',
    capabilities: [],
  });
}

function makeInstance(task: Record<string, unknown>) {
  return {
    instanceId: (task.instanceId as string) ?? 'test-1',
    depth: (task.depth as number) ?? 1,
    task: {
      taskId: (task.taskId as string) ?? 't1',
      description: (task.description as string) ?? '',
      mode: (task.mode as 'sync' | 'async') ?? 'sync',
      timeoutMs: 30000,
      inheritContext: false,
    },
  };
}

describe('agent-factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createAgentFromType - safe worker (researcher)', () => {
    it('should create agent with only safe tools', () => {
      const parent = createParentAgent();
      const availableTools = makeAvailableTools();
      const config = makeConfig();

      const def: AgentTypeDefinition = {
        typeId: 'researcher',
        displayName: 'Researcher',
        whenToUse: 'Research',
        role: 'worker',
        capabilities: [],
        toolPolicy: { mode: 'safe' },
        permissionMode: 'restricted',
        source: 'builtin',
        maxTurns: 30,
        maxSpawnDepth: 0,
        getSystemPrompt: (ctx) => `Researcher: ${ctx.taskDescription}`,
      };

      const agent = createAgentFromType(
        def,
        makeInstance({ instanceId: 'test-researcher-1', depth: 1, description: 'Search' }),
        parent,
        availableTools,
        config
      );

      expect(agent.agentId).toBe('test-researcher-1');
      expect(agent.displayName).toBe('Researcher');

      const toolIds = getToolNames(agent);
      expect(toolIds).not.toContain('WriteFile');
      expect(toolIds).not.toContain('EditFile');
      expect(toolIds).not.toContain('Exec');
      expect(toolIds).not.toContain('AgentTool');
      expect(toolIds).not.toContain('SpawnSubAgents');
      expect(toolIds).not.toContain('SendMessage');
    });

    it('should set custom system prompt override', () => {
      const parent = createParentAgent();
      const availableTools = makeAvailableTools();
      const config = makeConfig();

      const def: AgentTypeDefinition = {
        typeId: 'researcher',
        displayName: 'Researcher',
        whenToUse: 'Research',
        role: 'worker',
        capabilities: [],
        toolPolicy: { mode: 'safe' },
        permissionMode: 'restricted',
        source: 'builtin',
        maxTurns: 30,
        maxSpawnDepth: 0,
        getSystemPrompt: (ctx) => `Custom: ${ctx.taskDescription} | ${ctx.workdir}`,
      };

      const agent = createAgentFromType(
        def,
        makeInstance({ description: 'Search docs' }),
        parent,
        availableTools,
        config
      );

      expect(agent.systemPromptOverride).toContain('Custom: Search docs');
    });
  });

  describe('createAgentFromType - standard worker (coder)', () => {
    it('should create agent with standard tools (safe + write + exec)', () => {
      const parent = createParentAgent();
      const availableTools = makeAvailableTools();
      const config = makeConfig();

      const def: AgentTypeDefinition = {
        typeId: 'coder',
        displayName: 'Coder',
        whenToUse: 'Code',
        role: 'worker',
        capabilities: [],
        toolPolicy: { mode: 'standard' },
        permissionMode: 'bubble',
        source: 'builtin',
        maxTurns: 100,
        maxSpawnDepth: 0,
        getSystemPrompt: () => 'Coder prompt',
      };

      const agent = createAgentFromType(
        def,
        makeInstance({ instanceId: 'test-coder-1', depth: 1, description: 'Implement feature' }),
        parent,
        availableTools,
        config
      );

      const toolIds = getToolNames(agent);
      expect(toolIds).toContain('WriteFile');
      expect(toolIds).toContain('EditFile');
      expect(toolIds).toContain('Exec');
      expect(toolIds).toContain('ReadFile');
      expect(toolIds).toContain('Glob');
    });

    it('should exclude spawn/send tools for non-spawnable worker', () => {
      const parent = createParentAgent();
      const availableTools = makeAvailableTools();
      const config = makeConfig();

      const def: AgentTypeDefinition = {
        typeId: 'coder',
        displayName: 'Coder',
        whenToUse: 'Code',
        role: 'worker',
        capabilities: [],
        toolPolicy: { mode: 'standard' },
        permissionMode: 'bubble',
        source: 'builtin',
        maxTurns: 100,
        maxSpawnDepth: 0,
        getSystemPrompt: () => '',
      };

      const agent = createAgentFromType(
        def,
        makeInstance({ depth: 1 }),
        parent,
        availableTools,
        config
      );

      const toolIds = getToolNames(agent);
      expect(toolIds).not.toContain('AgentTool');
      expect(toolIds).not.toContain('SpawnSubAgents');
      expect(toolIds).not.toContain('SendMessage');
    });
  });

  describe('createAgentFromType - coordinator role', () => {
    it('should only have coordinator tools', () => {
      const parent = createParentAgent();
      const availableTools = makeAvailableTools();
      const config = makeConfig();

      const def: AgentTypeDefinition = {
        typeId: 'coordinator',
        displayName: 'Coordinator',
        whenToUse: 'Orchestrate',
        role: 'coordinator',
        capabilities: [],
        toolPolicy: { mode: 'full' },
        permissionMode: 'inherit',
        source: 'builtin',
        maxTurns: 200,
        maxSpawnDepth: 2,
        getSystemPrompt: () => 'Coordinator',
      };

      const agent = createAgentFromType(
        def,
        makeInstance({ instanceId: 'coord-1', depth: 0, description: 'Orchestrate' }),
        parent,
        availableTools,
        config
      );

      const toolIds = getToolNames(agent);
      expect(toolIds).toContain('AgentTool');
      expect(toolIds).toContain('SendMessage');
      expect(toolIds).toContain('TaskStop');

      expect(toolIds).not.toContain('WriteFile');
      expect(toolIds).not.toContain('EditFile');
      expect(toolIds).not.toContain('Exec');
      expect(toolIds).not.toContain('ReadFile');
    });
  });

  describe('createAgentFromType - spawnable worker', () => {
    it('should include AgentTool for spawnable worker at allowed depth', () => {
      const parent = createParentAgent();
      const availableTools = makeAvailableTools();
      const config = makeConfig({ maxGlobalDepth: 2 });

      const def: AgentTypeDefinition = {
        typeId: 'planner',
        displayName: 'Planner',
        whenToUse: 'Plan',
        role: 'worker',
        capabilities: [],
        toolPolicy: { mode: 'standard' },
        permissionMode: 'bubble',
        source: 'builtin',
        maxTurns: 50,
        maxSpawnDepth: 1,
        getSystemPrompt: () => '',
      };

      const agent = createAgentFromType(
        def,
        makeInstance({ instanceId: 'planner-1', depth: 1 }),
        parent,
        availableTools,
        config
      );

      const toolIds = getToolNames(agent);
      // depth=1, maxGlobalDepth=2, maxSpawnDepth=1 → canSpawn = true
      expect(toolIds).toContain('AgentTool');
    });

    it('should exclude AgentTool at max depth', () => {
      const parent = createParentAgent();
      const availableTools = makeAvailableTools();
      const config = makeConfig({ maxGlobalDepth: 2 });

      const def: AgentTypeDefinition = {
        typeId: 'planner',
        displayName: 'Planner',
        whenToUse: 'Plan',
        role: 'worker',
        capabilities: [],
        toolPolicy: { mode: 'standard' },
        permissionMode: 'bubble',
        source: 'builtin',
        maxTurns: 50,
        maxSpawnDepth: 1,
        getSystemPrompt: () => '',
      };

      const agent = createAgentFromType(
        def,
        makeInstance({ instanceId: 'planner-deep', depth: 2 }),
        parent,
        availableTools,
        config
      );

      const toolIds = getToolNames(agent);
      // depth=2, maxGlobalDepth=2 → canSpawn = false
      expect(toolIds).not.toContain('AgentTool');
    });
  });

  describe('createAgentFromType - custom tool policy', () => {
    it('should only include specified tools', () => {
      const parent = createParentAgent();
      const availableTools = makeAvailableTools();
      const config = makeConfig();

      const def: AgentTypeDefinition = {
        typeId: 'custom-worker',
        displayName: 'Custom',
        whenToUse: 'Custom',
        role: 'worker',
        capabilities: [],
        toolPolicy: { mode: 'custom', tools: ['ReadFile', 'Grep', 'WebFetch'] },
        permissionMode: 'restricted',
        source: 'user',
        maxTurns: 30,
        maxSpawnDepth: 0,
        getSystemPrompt: () => '',
      };

      const agent = createAgentFromType(
        def,
        makeInstance({ instanceId: 'custom-1', depth: 1 }),
        parent,
        availableTools,
        config
      );

      const toolIds = getToolNames(agent);
      expect(toolIds).toContain('ReadFile');
      expect(toolIds).toContain('Grep');
      expect(toolIds).toContain('WebFetch');
      expect(toolIds).not.toContain('Glob');
      expect(toolIds).not.toContain('WebSearch');
    });
  });

  describe('createAgentFromType - inherit tool policy', () => {
    it('should include all tools except spawn tools', () => {
      const parent = createParentAgent();
      const availableTools = makeAvailableTools();
      const config = makeConfig();

      const def: AgentTypeDefinition = {
        typeId: 'inherit-worker',
        displayName: 'Inherit',
        whenToUse: 'Inherit',
        role: 'worker',
        capabilities: [],
        toolPolicy: { mode: 'inherit' },
        permissionMode: 'inherit',
        source: 'user',
        maxTurns: 50,
        maxSpawnDepth: 0,
        getSystemPrompt: () => '',
      };

      const agent = createAgentFromType(
        def,
        makeInstance({ instanceId: 'inherit-1', depth: 1 }),
        parent,
        availableTools,
        config
      );

      const toolIds = getToolNames(agent);
      expect(toolIds).toContain('ReadFile');
      expect(toolIds).toContain('WriteFile');
      expect(toolIds).toContain('Exec');
      expect(toolIds).not.toContain('AgentTool');
      expect(toolIds).not.toContain('SpawnSubAgents');
    });
  });

  describe('createAgentFromType - full tool policy', () => {
    it('should include all tools except spawn tools', () => {
      const parent = createParentAgent();
      const availableTools = makeAvailableTools();
      const config = makeConfig();

      const def: AgentTypeDefinition = {
        typeId: 'full-worker',
        displayName: 'Full',
        whenToUse: 'Full',
        role: 'worker',
        capabilities: [],
        toolPolicy: { mode: 'full' },
        permissionMode: 'inherit',
        source: 'builtin',
        maxTurns: 50,
        maxSpawnDepth: 0,
        getSystemPrompt: () => '',
      };

      const agent = createAgentFromType(
        def,
        makeInstance({ instanceId: 'full-1', depth: 1 }),
        parent,
        availableTools,
        config
      );

      const toolIds = getToolNames(agent);
      expect(toolIds).toContain('ReadFile');
      expect(toolIds).toContain('WriteFile');
      expect(toolIds).toContain('Exec');
      expect(toolIds).not.toContain('AgentTool');
      expect(toolIds).not.toContain('SpawnSubAgents');
    });
  });
});
