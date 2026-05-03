/**
 * Sub-Agent 集成测试
 *
 * 通过 mock 内部 PiAgent 模拟子 Agent 执行，验证完整的 spawn → execute → collect 流程。
 */
import { describe, expect, it, vi } from 'vitest';
import { createReplBuiltinTools } from '@/cli/repl/repl-agent-tools';
import type { SubAgentConfig } from '@/config/types';
import { createLlmBasedAgent } from '@/core/agent-runtime/agent-adapter';

const subAgentConfig: SubAgentConfig = {
  enabled: true,
  maxConcurrent: 3,
  taskTimeoutMs: 10_000,
  maxOutputChars: 1000,
  maxTurns: 5,
  allowRecursiveSpawn: false,
};

describe('Sub-Agent Integration', () => {
  it('should register spawn_subagents when parentAgent and config are provided', () => {
    const parentAgent = createLlmBasedAgent({
      agentId: 'test-parent',
      displayName: 'Test Parent',
      capabilities: [{ id: 'test', name: '测试', description: 'test', category: 'code-analysis' }],
    });

    const tools = createReplBuiltinTools(
      undefined,
      undefined,
      undefined,
      parentAgent,
      subAgentConfig
    );

    const spawnTool = tools.find((t) => t.id === 'spawn_subagents');
    expect(spawnTool).toBeDefined();
    expect(spawnTool?.id).toBe('spawn_subagents');
    expect(spawnTool?.label).toBe('派生子 Agent');
  });

  it('should NOT register spawn_subagents when parentAgent is missing', () => {
    const tools = createReplBuiltinTools(
      undefined,
      undefined,
      undefined,
      undefined,
      subAgentConfig
    );

    const spawnTool = tools.find((t) => t.id === 'spawn_subagents');
    expect(spawnTool).toBeUndefined();
  });

  it('should have spawn_subagents with all safe tools available', () => {
    const parentAgent = createLlmBasedAgent({
      agentId: 'test-parent',
      displayName: 'Test Parent',
      capabilities: [{ id: 'test', name: '测试', description: 'test', category: 'code-analysis' }],
    });

    const tools = createReplBuiltinTools(
      undefined,
      undefined,
      undefined,
      parentAgent,
      subAgentConfig
    );
    const spawnTool = tools.find((t) => t.id === 'spawn_subagents');
    expect(spawnTool).toBeDefined();

    // 验证工具列表包含安全工具
    const toolIds = tools.map((t) => t.id);
    expect(toolIds).toContain('read_file');
    expect(toolIds).toContain('glob');
    expect(toolIds).toContain('grep');
    expect(toolIds).toContain('web_fetch');
    expect(toolIds).toContain('web_search');
  });

  it('should execute spawn_subagents and return results (mocked sub-agents)', async () => {
    const parentAgent = createLlmBasedAgent({
      agentId: 'test-parent',
      displayName: 'Test Parent',
      capabilities: [{ id: 'test', name: '测试', description: 'test', category: 'code-analysis' }],
    });

    // 为父 Agent mock，防止实际 LLM 调用
    vi.spyOn(parentAgent.innerAgent, 'prompt').mockResolvedValue(undefined);
    vi.spyOn(parentAgent.innerAgent, 'waitForIdle').mockResolvedValue(undefined);

    const tools = createReplBuiltinTools(
      undefined,
      undefined,
      undefined,
      parentAgent,
      subAgentConfig
    );

    // 手动注册工具并注入 mock
    parentAgent.clearTools();
    for (const tool of tools) {
      if (tool.id === 'spawn_subagents') {
        // 保留 spawn_subagents 工具
        // biome-ignore lint/suspicious/noExplicitAny: 测试中 mock 工具类型擦除
        parentAgent.registerTools([tool as any]);
      }
    }

    const spawnTool = tools.find((t) => t.id === 'spawn_subagents');
    expect(spawnTool).toBeDefined();
    if (!spawnTool) return; // TypeScript narrows to defined

    const result = await spawnTool.execute('test-call-1', {
      agents: [
        { id: 'task-a', description: '搜索 TypeScript 类型系统' },
        { id: 'task-b', description: '搜索 Vitest 最佳实践' },
      ],
      context: '这是集成测试',
    });

    // 验证返回结构
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.details).toBeDefined();
    // biome-ignore lint/suspicious/noExplicitAny: 测试中提取 details 结构
    const details = result.details as any;
    expect(details.total).toBe(2);

    // 由于子 Agent 没有真实的 LLM 后端，它们应该失败
    // 但流程本身应该正确执行（不会崩溃）
    expect(details.results).toHaveLength(2);
    for (const r of details.results) {
      expect(r.specId).toBeDefined();
      expect(['success', 'failure']).toContain(r.status);
      expect(typeof r.duration).toBe('number');
    }

    // summary 应该被生成
    expect(typeof details.summary).toBe('string');
    expect(details.summary.length).toBeGreaterThan(0);
  }, 15_000);
});
