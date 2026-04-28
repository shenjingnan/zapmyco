import { describe, expect, it } from 'vitest';
import { OutputFormatter } from '../../../../cli/repl/components/output-area.js';
import type { ZapmycoConfig } from '../../../../config/types.js';
import type { FinalResult } from '../../../core/result/types.js';
import type { TaskGraph } from '../../../core/task/types.js';
import type { AgentRegistration } from '../../../protocol/capability.js';
import type { HistoryEntry, SessionStats } from '../../types.js';

function createFormatter(color = false): OutputFormatter {
  return new OutputFormatter(color);
}

const baseResult: FinalResult = {
  goalId: 'goal-1',
  overallStatus: 'success',
  summary: '测试任务完成',
  taskResults: [],
  allArtifacts: [],
  totalDuration: 5000,
  totalTokenUsage: {
    inputTokens: 100,
    outputTokens: 200,
    totalTokens: 300,
    estimatedCostUsd: 0.001,
  },
};

const baseConfig: ZapmycoConfig = {
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

describe('OutputFormatter', () => {
  describe('formatResult', () => {
    it('success 状态应显示成功图标和状态', () => {
      const f = createFormatter();
      const lines = f.formatResult({ ...baseResult, overallStatus: 'success' });
      const text = lines.join('\n');
      expect(text).toContain('✅');
      expect(text).toContain('成功');
    });

    it('partial-failure 状态应显示警告图标', () => {
      const f = createFormatter();
      const lines = f.formatResult({ ...baseResult, overallStatus: 'partial-failure' });
      const text = lines.join('\n');
      expect(text).toContain('⚠️');
      expect(text).toContain('部分成功');
    });

    it('failure 状态应显示失败图标', () => {
      const f = createFormatter();
      const lines = f.formatResult({ ...baseResult, overallStatus: 'failure' });
      const text = lines.join('\n');
      expect(text).toContain('❌');
      expect(text).toContain('失败');
    });

    it('包含任务结果时应显示任务拆分信息', () => {
      const f = createFormatter();
      const result: FinalResult = {
        ...baseResult,
        taskResults: [
          {
            taskId: 'task-1',
            status: 'success',
            output: null,
            artifacts: [],
            duration: 1000,
            tokenUsage: {
              inputTokens: 10,
              outputTokens: 20,
              totalTokens: 30,
              estimatedCostUsd: 0.0001,
            },
          },
          {
            taskId: 'task-2',
            status: 'failed',
            output: null,
            artifacts: [],
            duration: 2000,
            tokenUsage: {
              inputTokens: 10,
              outputTokens: 20,
              totalTokens: 30,
              estimatedCostUsd: 0.0001,
            },
          },
        ],
      };
      const lines = f.formatResult(result);
      const text = lines.join('\n');
      expect(text).toContain('任务拆分');
      expect(text).toContain('2 个子任务');
    });

    it('包含制品时应显示制品列表', () => {
      const f = createFormatter();
      const result: FinalResult = {
        ...baseResult,
        allArtifacts: [
          { type: 'file', reference: '/src/test.ts', description: '测试文件' },
          { type: 'pull-request', reference: 'pr/123', description: '功能 PR' },
        ],
      };
      const lines = f.formatResult(result);
      const text = lines.join('\n');
      expect(text).toContain('制品');
      expect(text).toContain('📄');
      expect(text).toContain('🔗');
    });

    it('包含 nextSteps 时应显示建议步骤', () => {
      const f = createFormatter();
      const result: FinalResult = {
        ...baseResult,
        nextSteps: ['运行测试', '提交代码', '创建 PR'],
      };
      const lines = f.formatResult(result);
      const text = lines.join('\n');
      expect(text).toContain('建议');
      expect(text).toContain('1. 运行测试');
      expect(text).toContain('2. 提交代码');
      expect(text).toContain('3. 创建 PR');
    });

    it('无任务结果和制品时不应显示对应区块', () => {
      const f = createFormatter();
      const lines = f.formatResult(baseResult);
      const text = lines.join('\n');
      expect(text).not.toContain('任务拆分');
      expect(text).not.toContain('制品');
      expect(text).not.toContain('建议');
    });
  });

  describe('formatError', () => {
    it('普通错误应显示错误消息', () => {
      const f = createFormatter();
      const lines = f.formatError(new Error('出错了'));
      const text = lines.join('\n');
      expect(text).toContain('执行失败');
      expect(text).toContain('出错了');
    });

    it('带 code 的错误应结构化显示', () => {
      const f = createFormatter();
      const err = Object.assign(new Error('配置无效'), {
        code: 'CONFIG_ERROR',
        context: { key: 'missing' },
      });
      const lines = f.formatError(err);
      const text = lines.join('\n');
      expect(text).toContain('[CONFIG_ERROR]');
      expect(text).toContain('详情');
    });

    it('带 code 但无 context 的错误不应显示详情行', () => {
      const f = createFormatter();
      const err = Object.assign(new Error('test'), { code: 'NO_CONTEXT' });
      const lines = f.formatError(err);
      const text = lines.join('\n');
      expect(text).toContain('[NO_CONTEXT]');
      expect(text).not.toContain('详情');
    });
  });

  describe('formatAgents', () => {
    it('空 agent 列表应显示暂无提示', () => {
      const f = createFormatter();
      const lines = f.formatAgents([]);
      const text = lines.join('\n');
      expect(text).toContain('暂无已注册的 Agent');
    });

    it('多个 agent 应正确格式化', () => {
      const f = createFormatter();
      const agents: AgentRegistration[] = [
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
        {
          agentId: 'review-agent',
          displayName: '审查专家',
          capabilities: [
            { id: 'code-review', name: '代码审查', description: '', category: 'code-review' },
          ],
          status: 'busy',
          currentLoad: 2,
          maxConcurrency: 2,
        },
        {
          agentId: 'offline-agent',
          displayName: '离线代理',
          capabilities: [],
          status: 'offline',
          currentLoad: 0,
          maxConcurrency: 1,
        },
      ];
      const lines = f.formatAgents(agents);
      const text = lines.join('\n');
      expect(text).toContain('code-agent');
      expect(text).toContain('●'); // online/busy 绿色/黄色圆点
      expect(text).toContain('○'); // offline 灰色圆点
      expect(text).toContain('代码生成');
    });
  });

  describe('formatConfig', () => {
    it('有 apiKey 时应脱敏显示', () => {
      const f = createFormatter();
      const lines = f.formatConfig(baseConfig);
      const text = lines.join('\n');
      expect(text).toContain('已配置');
      expect(text).not.toContain('sk-test');
    });

    it('无 apiKey 时应显示未配置', () => {
      const f = createFormatter();
      const config = { ...baseConfig, llm: { ...baseConfig.llm, apiKey: '' } };
      const lines = f.formatConfig(config);
      const text = lines.join('\n');
      expect(text).toContain('(未配置)');
    });

    it('无 model 时应显示默认提示', () => {
      const f = createFormatter();
      const config = { ...baseConfig, llm: { ...baseConfig.llm, model: undefined } };
      const lines = f.formatConfig(config);
      const text = lines.join('\n');
      expect(text).toContain('(默认)');
    });

    it('应包含所有配置区域', () => {
      const f = createFormatter();
      const lines = f.formatConfig(baseConfig);
      const text = lines.join('\n');
      expect(text).toContain('LLM');
      expect(text).toContain('调度器');
      expect(text).toContain('CLI');
      expect(text).toContain('Agents');
    });
  });

  describe('formatHistory', () => {
    it('空历史记录应显示暂无提示', () => {
      const f = createFormatter();
      const lines = f.formatHistory([]);
      const text = lines.join('\n');
      expect(text).toContain('暂无历史记录');
    });

    it('应正确格式化历史条目', () => {
      const f = createFormatter();
      const entries: HistoryEntry[] = [
        { id: 1, timestamp: 1700000000000, input: '第一个目标', goalId: 'g-1', durationMs: 1200 },
        { id: 2, timestamp: 1700000100000, input: '第二个目标' },
      ];
      const lines = f.formatHistory(entries);
      const text = lines.join('\n');
      expect(text).toContain('#  1');
      expect(text).toContain('第一个目标');
      expect(text).toContain('#  2');
      expect(text).toContain('第二个目标');
      expect(text).toContain('(1.2s)'); // durationMs 格式化
    });

    it('长输入应截断显示', () => {
      const f = createFormatter();
      const longInput = 'a'.repeat(100);
      const entries: HistoryEntry[] = [{ id: 1, timestamp: Date.now(), input: longInput }];
      const lines = f.formatHistory(entries);
      const text = lines.join('\n');
      expect(text).toContain('...');
    });
  });

  describe('formatStatus', () => {
    it('idle 状态应显示空闲（绿色）', () => {
      const f = createFormatter(false); // 关闭颜色方便断言文本
      const stats: SessionStats = {
        totalRequests: 5,
        successCount: 4,
        failureCount: 1,
        totalTokens: 10000,
        totalCostUsd: 0.05,
        state: 'idle',
      };
      const lines = f.formatStatus(stats);
      const text = lines.join('\n');
      expect(text).toContain('空闲');
      expect(text).toContain('5');
      expect(text).toContain('4');
      expect(text).toContain('1');
    });

    it('executing 状态应显示执行中', () => {
      const f = createFormatter(false);
      const stats: SessionStats = {
        totalRequests: 0,
        successCount: 0,
        failureCount: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        state: 'executing',
      };
      const lines = f.formatStatus(stats);
      const text = lines.join('\n');
      expect(text).toContain('执行中');
    });

    it('shutting-down 状态应显示关闭中', () => {
      const f = createFormatter(false);
      const stats: SessionStats = {
        totalRequests: 0,
        successCount: 0,
        failureCount: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        state: 'shutting-down',
      };
      const lines = f.formatStatus(stats);
      const text = lines.join('\n');
      expect(text).toContain('关闭中');
    });
  });

  describe('formatTaskGraph', () => {
    it('单层任务图应正确渲染', () => {
      const f = createFormatter();
      const graph: TaskGraph = {
        goalId: 'goal-1',
        nodes: new Map([
          [
            'task-1',
            {
              id: 'task-1',
              name: '分析需求',
              description: '分析用户需求文档',
              requiredCapability: {
                id: 'analysis',
                name: '分析',
                description: '',
                category: 'analysis',
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
      const lines = f.formatTaskGraph(graph);
      const text = lines.join('\n');
      expect(text).toContain('任务拆分概览');
      expect(text).toContain('分析需求');
      expect(text).toContain('1 个子任务');
    });

    it('多层任务图应分层渲染', () => {
      const f = createFormatter();
      const graph: TaskGraph = {
        goalId: 'goal-1',
        nodes: new Map([
          [
            'task-1',
            {
              id: 'task-1',
              name: '第一步',
              description: '第一步描述',
              requiredCapability: { id: 'c1', name: 'c1', description: '', category: 'c1' },
              dependencies: [],
              priority: 1,
              status: 'succeeded',
            },
          ],
          [
            'task-2',
            {
              id: 'task-2',
              name: '第二步',
              description: '第二步描述',
              requiredCapability: { id: 'c2', name: 'c2', description: '', category: 'c2' },
              dependencies: ['task-1'],
              priority: 2,
              status: 'running',
            },
          ],
        ]),
        edges: [{ from: 'task-1', to: 'task-2' }],
        entryNodes: ['task-1'],
        layers: [['task-1'], ['task-2']],
      };
      const lines = f.formatTaskGraph(graph);
      const text = lines.join('\n');
      expect(text).toContain('第 1 层');
      expect(text).toContain('第 2 层');
      expect(text).toContain('2 层并行');
    });

    it('不同任务状态应显示不同图标', () => {
      const f = createFormatter(false);
      const graph: TaskGraph = {
        goalId: 'goal-1',
        nodes: new Map([
          [
            'ok',
            {
              id: 'ok',
              name: '成功任务',
              description: '成功任务描述',
              requiredCapability: { id: 'x', name: 'x', description: '', category: 'x' },
              dependencies: [],
              priority: 1,
              status: 'succeeded',
            },
          ],
          [
            'run',
            {
              id: 'run',
              name: '运行中',
              description: '运行中描述',
              requiredCapability: { id: 'x', name: 'x', description: '', category: 'x' },
              dependencies: [],
              priority: 1,
              status: 'running',
            },
          ],
          [
            'fail',
            {
              id: 'fail',
              name: '失败任务',
              description: '失败任务描述',
              requiredCapability: { id: 'x', name: 'x', description: '', category: 'x' },
              dependencies: [],
              priority: 1,
              status: 'failed',
            },
          ],
          [
            'cancel',
            {
              id: 'cancel',
              name: '已取消',
              description: '已取消描述',
              requiredCapability: { id: 'x', name: 'x', description: '', category: 'x' },
              dependencies: [],
              priority: 1,
              status: 'cancelled',
            },
          ],
          [
            'skip',
            {
              id: 'skip',
              name: '已跳过',
              description: '已跳过描述',
              requiredCapability: { id: 'x', name: 'x', description: '', category: 'x' },
              dependencies: [],
              priority: 1,
              status: 'skipped',
            },
          ],
        ]),
        edges: [],
        entryNodes: ['ok', 'run', 'fail', 'cancel', 'skip'],
        layers: [['ok', 'run', 'fail', 'cancel', 'skip']],
      };
      const lines = f.formatTaskGraph(graph);
      const text = lines.join('\n');
      expect(text).toContain('✓'); // succeeded
      expect(text).toContain('⟳'); // running
      expect(text).toContain('✗'); // failed
      expect(text).toContain('⊘'); // cancelled/skipped
    });
  });

  describe('formatWelcome', () => {
    it('应返回包含版本号的欢迎信息', () => {
      const f = createFormatter();
      const lines = f.formatWelcome('2.0.0');
      const text = lines.join('\n');
      expect(text).toContain('zapmyco@2.0.0');
      expect(text).toContain('欢迎回来');
    });
  });
});
