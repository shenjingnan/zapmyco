import { describe, expect, it } from 'vitest';
import { Renderer } from '../../../cli/repl/renderer.js';
import type { HistoryEntry, ReplOptions, SessionStats } from '../../../cli/repl/types.js';
import type { ZapmycoConfig } from '../../../config/types.js';
import type { FinalResult } from '../../../core/result/types.js';
import type { TaskGraph } from '../../../core/task/types.js';
import type { AgentRegistration } from '../../../protocol/capability.js';

function createRenderer(color = false): Renderer {
  const opts: ReplOptions = {
    color,
    debug: false,
    maxHistorySize: 100,
    prompt: '> ',
    continuationPrompt: '... ',
  };
  return new Renderer(opts);
}

const mockFinalResult: FinalResult = {
  goalId: 'goal-1',
  overallStatus: 'success',
  summary: '测试任务完成',
  taskResults: [
    {
      taskId: 'task-1',
      status: 'success',
      output: null,
      artifacts: [],
      duration: 1000,
      tokenUsage: {
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        estimatedCostUsd: 0.001,
      },
    },
  ],
  allArtifacts: [{ type: 'file', reference: '/src/test.ts', description: '测试文件' }],
  totalDuration: 5000,
  totalTokenUsage: {
    inputTokens: 100,
    outputTokens: 200,
    totalTokens: 300,
    estimatedCostUsd: 0.001,
  },
  nextSteps: ['运行测试', '提交代码'],
};

const mockTaskGraph: TaskGraph = {
  goalId: 'goal-1',
  nodes: new Map([
    [
      'task-1',
      {
        id: 'task-1',
        name: '分析代码',
        description: '分析项目代码结构',
        requiredCapability: {
          id: 'code-analysis',
          name: '代码分析',
          description: '',
          category: 'code-analysis',
        },
        dependencies: [],
        priority: 1,
        status: 'succeeded',
      },
    ],
  ]),
  edges: [],
  entryNodes: ['task-1'],
  layers: [['task-1']],
};

const mockAgents: AgentRegistration[] = [
  {
    agentId: 'code-agent',
    displayName: '代码专家',
    capabilities: [
      { id: 'code-gen', name: '代码生成', description: '', category: 'code-generation' },
    ],
    status: 'online',
    currentLoad: 0,
    maxConcurrency: 3,
  },
];

const mockConfig: ZapmycoConfig = {
  llm: { provider: 'anthropic', apiKey: 'sk-test', model: 'claude-sonnet' },
  scheduler: {
    maxConcurrency: 5,
    maxPerAgent: 3,
    taskTimeoutMs: 1800000,
    maxRetries: 3,
    retryBaseDelayMs: 1000,
  },
  agents: [{ id: 'code-agent', enabled: true }],
  cli: { color: true, debug: false, outputFormat: 'text' },
};

const mockHistory: HistoryEntry[] = [
  { id: 1, timestamp: 1000, input: '第一个目标', goalId: 'g-1', durationMs: 1000 },
  { id: 2, timestamp: 2000, input: '第二个目标' },
];

const mockStats: SessionStats = {
  totalRequests: 10,
  successCount: 8,
  failureCount: 2,
  totalTokens: 50000,
  totalCostUsd: 0.1234,
  state: 'idle',
};

describe('Renderer', () => {
  it('renderWelcome 应返回欢迎信息行数组', () => {
    const r = createRenderer();
    const lines = r.renderWelcome('1.0.0');
    const text = lines.join('\n');
    expect(text).toContain('zapmyco');
    expect(text).toContain('1.0.0');
    expect(text).toContain('欢迎回来');
  });

  it('renderError 应返回错误信息行数组', () => {
    const r = createRenderer();
    const lines = r.renderError(new Error('测试错误'));
    const text = lines.join('\n');
    expect(text).toContain('执行失败');
    expect(text).toContain('测试错误');
  });

  it('renderError 带 code 的错误应结构化显示', () => {
    const r = createRenderer();
    const err = Object.assign(new Error('test'), { code: 'TEST_ERROR', context: { key: 'value' } });
    const lines = r.renderError(err);
    const text = lines.join('\n');
    expect(text).toContain('[TEST_ERROR]');
  });

  it('renderResult 应返回结果卡片行数组', () => {
    const r = createRenderer();
    const lines = r.renderResult(mockFinalResult);
    const text = lines.join('\n');
    expect(text).toContain('执行完成');
    expect(text).toContain('测试任务完成');
    expect(text).toContain('任务拆分');
  });

  it('renderTaskGraph 应返回任务概览行数组', () => {
    const r = createRenderer();
    const lines = r.renderTaskGraph(mockTaskGraph);
    const text = lines.join('\n');
    expect(text).toContain('任务拆分概览');
    expect(text).toContain('分析代码');
  });

  it('renderAgents 应返回 Agent 列表行数组', () => {
    const r = createRenderer();
    const lines = r.renderAgents(mockAgents);
    const text = lines.join('\n');
    expect(text).toContain('已注册 Agent');
    expect(text).toContain('code-agent');
  });

  it('renderConfig 应返回配置信息行数组', () => {
    const r = createRenderer();
    const lines = r.renderConfig(mockConfig);
    const text = lines.join('\n');
    expect(text).toContain('当前配置');
    expect(text).toContain('anthropic');
    // apiKey 应脱敏
    expect(text).not.toContain('sk-test');
  });

  it('renderHistory 应返回历史记录行数组', () => {
    const r = createRenderer();
    const lines = r.renderHistory(mockHistory);
    const text = lines.join('\n');
    expect(text).toContain('会话历史');
    expect(text).toContain('第一个目标');
    expect(text).toContain('第二个目标');
  });

  it('renderStatus 应返回会话统计行数组', () => {
    const r = createRenderer();
    const lines = r.renderStatus(mockStats);
    const text = lines.join('\n');
    expect(text).toContain('会话状态');
    expect(text).toContain('10'); // totalRequests
    expect(text).toContain('8'); // success
  });

  it('颜色关闭时不应包含 ANSI 转义序列', () => {
    const r = createRenderer(false);
    const lines = r.renderWelcome('1.0.0');
    const text = lines.join('');
    // 不应包含 ANSI 颜色转义序列
    expect(text).not.toContain('\u001b[');
  });
});
