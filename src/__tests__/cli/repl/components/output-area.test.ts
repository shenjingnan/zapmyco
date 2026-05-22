import { describe, expect, it } from 'vitest';
import { OutputArea, OutputFormatter } from '@/cli/repl/components/output-area';
import type { HistoryEntry, SessionStats } from '@/cli/repl/types';
import { Screen, StylePool } from '@/cli/tui';
import type { ZapmycoConfig } from '@/config/types';
import type { FinalResult } from '@/core/result/types';
import type { TaskGraph } from '@/core/task/types';
import type { AgentRegistration } from '@/protocol/capability';

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
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedCostUsd: 0.001,
  },
};

const baseConfig: ZapmycoConfig = {
  llm: {
    defaultModel: 'anthropic/claude-sonnet-4-20250514',
    providers: {
      anthropic: {
        apiKey: 'sk-test',
      },
    },
  },
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
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              estimatedCostUsd: 0.0001,
            },
          },
          {
            taskId: 'task-2',
            status: 'failure',
            output: null,
            artifacts: [],
            duration: 2000,
            tokenUsage: {
              inputTokens: 10,
              outputTokens: 20,
              totalTokens: 30,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
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
      const config = {
        ...baseConfig,
        llm: {
          ...baseConfig.llm,
          providers: { anthropic: {} },
        },
      };
      const lines = f.formatConfig(config);
      const text = lines.join('\n');
      expect(text).toContain('(未配置)');
    });

    it('应显示默认模型和提供商信息', () => {
      const f = createFormatter();
      const lines = f.formatConfig(baseConfig);
      const text = lines.join('\n');
      expect(text).toContain('默认模型:');
      expect(text).toContain('anthropic');
      expect(text).toContain('claude-sonnet-4-20250514');
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
              requiredCapability: {
                id: 'c1',
                name: 'c1',
                description: '',
                category: 'code-generation',
              },
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
              requiredCapability: {
                id: 'c2',
                name: 'c2',
                description: '',
                category: 'code-modification',
              },
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
              requiredCapability: { id: 'x', name: 'x', description: '', category: 'generic' },
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
              requiredCapability: { id: 'x', name: 'x', description: '', category: 'generic' },
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
              requiredCapability: { id: 'x', name: 'x', description: '', category: 'generic' },
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
              requiredCapability: { id: 'x', name: 'x', description: '', category: 'generic' },
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
              requiredCapability: { id: 'x', name: 'x', description: '', category: 'generic' },
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

// =============================================================================
// OutputArea 测试
// =============================================================================

describe('OutputArea', () => {
  function createScreen(rows = 10, cols = 40): Screen {
    return new Screen(rows, cols);
  }

  function createStylePool(): StylePool {
    return new StylePool();
  }

  describe('renderToScreen — 基础渲染', () => {
    it('空内容应清空整个 rect 区域', () => {
      const area = new OutputArea();
      const screen = createScreen();
      const pool = createStylePool();

      screen.setCell(0, 0, 'X', 1, 1);
      area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 10 });

      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 40; c++) {
          expect(screen.getCell(c, r).char).toBe('');
        }
      }
    });

    it('简单文本应正确渲染到 Screen', () => {
      const area = new OutputArea();
      area.append(['Hello World']);
      const screen = createScreen(5, 40);
      const pool = createStylePool();

      area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 5 });

      const cell = screen.getCell(0, 0);
      expect(cell.char).toBe('H');
      // 'Hello World' — 第 4 列是 'o'
      expect(screen.getCell(4, 0).char).toBe('o');
      // 第 5 列是空格
      expect(screen.getCell(5, 0).char).toBe(' ');
      // 第 6 列是 'W'
      expect(screen.getCell(6, 0).char).toBe('W');
    });

    it('多行文本应逐行渲染', () => {
      const area = new OutputArea();
      area.append(['Line 1', 'Line 2', 'Line 3']);
      const screen = createScreen(5, 40);
      const pool = createStylePool();

      area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 5 });

      expect(screen.getCell(0, 0).char).toBe('L');
      expect(screen.getCell(1, 0).char).toBe('i');
      expect(screen.getCell(0, 1).char).toBe('L');
      expect(screen.getCell(0, 2).char).toBe('L');
    });
  });

  describe('renderToScreen — 虚拟滚动偏移', () => {
    it('scrollOffset=0 应显示最新内容（底部）', () => {
      const area = new OutputArea();
      // 每行 1 个显示行（短文本），共 10 个显示行
      for (let i = 0; i < 10; i++) {
        area.append([`Line ${i}`]);
      }
      const screen = createScreen(3, 40);
      const pool = createStylePool();

      // scrollOffset=0, rect.height=3 → 显示最后 3 行
      area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 3 });

      // 应显示 Line 7, Line 8, Line 9
      expect(screen.getCell(0, 0).char).toBe('L');
      expect(screen.getCell(5, 0).char).toBe('7');
      expect(screen.getCell(5, 1).char).toBe('8');
      expect(screen.getCell(5, 2).char).toBe('9');
    });

    it('scrollOffset>0 应显示更早的内容', () => {
      const area = new OutputArea();
      for (let i = 0; i < 10; i++) {
        area.append([`Line ${i}`]);
      }
      const screen = createScreen(3, 40);
      const pool = createStylePool();

      // 模拟向上滚动 3 行
      area.handleScroll('up', 3);
      area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 3 });

      // scrollOffset=3: 原本显示 [7,8,9], 滚动 3 → 显示 [4,5,6]
      expect(screen.getCell(5, 0).char).toBe('4');
      expect(screen.getCell(5, 1).char).toBe('5');
      expect(screen.getCell(5, 2).char).toBe('6');
    });

    it('大幅滚动不应超出最早内容', () => {
      const area = new OutputArea();
      for (let i = 0; i < 5; i++) {
        area.append([`Line ${i}`]);
      }
      const screen = createScreen(3, 40);
      const pool = createStylePool();

      // 滚动 100 行（远超内容）
      area.handleScroll('up', 100);
      area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 3 });

      // 应显示最早的 3 行: Line 0, 1, 2
      expect(screen.getCell(5, 0).char).toBe('0');
      expect(screen.getCell(5, 1).char).toBe('1');
      expect(screen.getCell(5, 2).char).toBe('2');
    });
  });

  describe('followBottom', () => {
    it('scrollOffset=0 时 append 应自动跟随底部', () => {
      const area = new OutputArea();
      area.append(['Line A', 'Line B']);
      const screen = createScreen(2, 40);
      const pool = createStylePool();

      area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 2 });

      expect(screen.getCell(5, 0).char).toBe('A');
      expect(screen.getCell(5, 1).char).toBe('B');

      // append 新内容（也在底部）
      area.append(['Line C']);
      screen.clearRegion(0, 0, 40, 2);
      area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 2 });

      // 应显示最新的 2 行: B, C
      expect(screen.getCell(5, 0).char).toBe('B');
      expect(screen.getCell(5, 1).char).toBe('C');
    });

    it('向上滚动后 append 应保持视图稳定', () => {
      const area = new OutputArea();
      for (let i = 0; i < 5; i++) {
        area.append([`Line ${i}`]);
      }
      // 向上滚动 2 行
      area.handleScroll('up', 2);
      const screen = createScreen(2, 40);
      const pool = createStylePool();

      area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 2 });
      // scrollOffset=2: 显示底部起第 2 行开始 → Line 1, Line 2
      expect(screen.getCell(5, 0).char).toBe('1');
      expect(screen.getCell(5, 1).char).toBe('2');

      // 追加新行（此时 scrollOffset 自动调整）
      area.append(['Line 5']);
      screen.clearRegion(0, 0, 40, 2);
      area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 2 });
      // scrollOffset 已调整，视图应保持稳定（仍显示 Line 1, Line 2）
      expect(screen.getCell(5, 0).char).toBe('1');
      expect(screen.getCell(5, 1).char).toBe('2');
    });
  });

  describe('scrollToBottom', () => {
    it('向上滚动后调用 scrollToBottom 应恢复到底部', () => {
      const area = new OutputArea();
      for (let i = 0; i < 5; i++) {
        area.append([`Line ${i}`]);
      }
      area.handleScroll('up', 3);
      area.scrollToBottom();

      const screen = createScreen(2, 40);
      const pool = createStylePool();
      area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 2 });

      // scrollToBottom 后应显示底部: [3,4]
      expect(screen.getCell(5, 0).char).toBe('3');
      expect(screen.getCell(5, 1).char).toBe('4');
    });
  });

  describe('maxLines 行数上限', () => {
    it('超出 MAX_LINES 时应丢弃最早的行', () => {
      const area = new OutputArea();
      // 由于 MAX_LINES 是 10000，直接测试 10001 行速度太慢
      // 验证 append 超过限制后 lines 数量不超过 MAX_LINES
      const maxLines = (OutputArea as unknown as { MAX_LINES: number }).MAX_LINES ?? 10_000;

      // 追加 MAX_LINES + 10 行
      const linesToAdd = maxLines + 10;
      for (let i = 0; i < linesToAdd; i += 100) {
        const batch: string[] = [];
        for (let j = 0; j < 100 && i + j < linesToAdd; j++) {
          batch.push(`Line ${i + j}`);
        }
        area.append(batch);
      }

      // 验证 total lines 不超过 MAX_LINES
      const lines = (area as unknown as { lines: string[] }).lines;
      expect(lines.length).toBeLessThanOrEqual(maxLines);
    });

    it('逐出后最新的行仍可正常渲染', () => {
      const area = new OutputArea();
      const maxLines = 10_000;
      const linesToAdd = maxLines + 5;

      // 批量追加行
      const batch: string[] = [];
      for (let i = 0; i < linesToAdd; i++) {
        batch.push(`Line ${i}`);
      }
      area.append(batch);

      // 验证内部行数不超过上限
      const linesField = (area as unknown as { lines: string[] }).lines;
      expect(linesField.length).toBeLessThanOrEqual(maxLines);

      // 验证最早的可用行是 "Line 5"（前 5 行被丢弃）
      expect(linesField[0]).toBe('Line 5');

      const screen = createScreen(3, 40);
      const pool = createStylePool();
      area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 3 });

      // 应显示最新的 3 行（scrollOffset=0 → 底部）
      // linesField[9997] = 'Line 10002', [9998] = 'Line 10003', [9999] = 'Line 10004'
      // "Line 10002" → L(0) i(1) n(2) e(3) (4) 1(5) 0(6) 0(7) 0(8) 2(9)
      expect(screen.getCell(0, 0).char).toBe('L');
      expect(screen.getCell(5, 0).char).toBe('1');
      expect(screen.getCell(6, 0).char).toBe('0');
      expect(screen.getCell(6, 1).char).toBe('0');
      expect(screen.getCell(6, 2).char).toBe('0');
    });
  });

  describe('宽度变化', () => {
    it('width 变化时应重建换行缓存', () => {
      const area = new OutputArea();
      // 追加需要换行的长文本
      const longLine = 'A'.repeat(80);
      area.append([longLine]);

      const screen = createScreen(3, 40);
      const pool = createStylePool();

      // 用 40 列渲染 → 应换行为 2 行
      area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 3 });

      // (0,0) = 'A', (1,0) = 'A' (因为全 A)
      expect(screen.getCell(0, 0).char).toBe('A');

      // 用 80 列渲染 → 应为 1 行
      const screen2 = createScreen(3, 80);
      area.renderToScreen(screen2, pool, { x: 0, y: 0, width: 80, height: 3 });
      // (39,0) = 'A', (40,0) = ''（80 列不需要换行）
      expect(screen2.getCell(39, 0).char).toBe('A');
    });
  });

  describe('旧版 render(width) 兼容', () => {
    it('render(width) 应返回所有行的换行结果', () => {
      const area = new OutputArea();
      area.append(['Hello', 'World']);

      const lines = area.render(40);
      expect(lines.length).toBe(2);
      expect(lines[0]).toBe('Hello');
      expect(lines[1]).toBe('World');
    });

    it('长文本 render(width) 应正确换行', () => {
      const area = new OutputArea();
      area.append(['A'.repeat(60)]);

      const lines = area.render(40);
      expect(lines.length).toBe(2);
      expect(lines[0]).toBe('A'.repeat(40));
      expect(lines[1]).toBe('A'.repeat(20));
    });
  });

  describe('流式输出 appendText', () => {
    it('appendText 应追加到最后一行', () => {
      const area = new OutputArea();
      area.append(['Hello']);

      area.appendText(' World');

      const screen = createScreen(3, 40);
      const pool = createStylePool();
      area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 3 });

      expect(screen.getCell(0, 0).char).toBe('H');
      expect(screen.getCell(6, 0).char).toBe('W');
    });

    it('空缓冲区时 appendText 应创建新行', () => {
      const area = new OutputArea();
      area.appendText('First');

      const screen = createScreen(3, 40);
      const pool = createStylePool();
      area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 3 });

      expect(screen.getCell(0, 0).char).toBe('F');
    });
  });

  describe('replaceLastLine', () => {
    it('应替换最后一行的内容', () => {
      const area = new OutputArea();
      area.append(['Line 1', 'Line 2']);
      area.replaceLastLine('Replaced');

      const screen = createScreen(3, 40);
      const pool = createStylePool();
      area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 3 });

      // 第一行是 "Line 1"，第二行是 "Replaced"
      expect(screen.getCell(0, 1).char).toBe('R');
      expect(screen.getCell(1, 1).char).toBe('e');
      expect(screen.getCell(2, 1).char).toBe('p');
      // 第一行不变
      expect(screen.getCell(0, 0).char).toBe('L');
      expect(screen.getCell(5, 0).char).toBe('1');
    });
  });

  describe('clear', () => {
    it('应清空所有内容', () => {
      const area = new OutputArea();
      area.append(['Some content', 'More content']);
      area.clear();

      const screen = createScreen(3, 40);
      const pool = createStylePool();
      area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 3 });

      // 所有单元格应为空
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 40; c++) {
          expect(screen.getCell(c, r).char).toBe('');
        }
      }
    });

    it('clear 后 append 应正常工作', () => {
      const area = new OutputArea();
      area.append(['Old']);
      area.clear();
      area.append(['New']);

      const screen = createScreen(3, 40);
      const pool = createStylePool();
      area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 3 });

      expect(screen.getCell(0, 0).char).toBe('N');
    });
  });

  describe('rect 位置偏移', () => {
    it('应以 rect.x 和 rect.y 为起始位置', () => {
      const area = new OutputArea();
      area.append(['Test']);
      const screen = createScreen(10, 40);
      const pool = createStylePool();

      area.renderToScreen(screen, pool, { x: 5, y: 3, width: 40, height: 5 });

      // 文本应从 (5, 3) 开始
      expect(screen.getCell(5, 3).char).toBe('T');
      expect(screen.getCell(6, 3).char).toBe('e');
      // (4, 3) 应为空（x 之前）
      expect(screen.getCell(4, 3).char).toBe('');
    });

    it('rect.height 小于内容时应只渲染可见部分', () => {
      const area = new OutputArea();
      for (let i = 0; i < 10; i++) {
        area.append([`Line ${i}`]);
      }
      const screen = createScreen(5, 40);
      const pool = createStylePool();

      // rect.height = 3，只显示 3 行
      area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 3 });

      // 应显示底部 3 行: Line 7, 8, 9
      expect(screen.getCell(5, 0).char).toBe('7');
      expect(screen.getCell(5, 1).char).toBe('8');
      expect(screen.getCell(5, 2).char).toBe('9');
      // 第 4 行应为空
      expect(screen.getCell(0, 3).char).toBe('');
    });
  });

  describe('scrollOffset 属性', () => {
    it('初始 scrollOffset 应为 0', () => {
      const area = new OutputArea();
      expect(area.scrollOffset).toBe(0);
    });

    it('向上滚动后 scrollOffset 应增加', () => {
      const area = new OutputArea();
      area.handleScroll('up', 5);
      expect(area.scrollOffset).toBe(5);
    });

    it('向下滚动不应低于 0', () => {
      const area = new OutputArea();
      area.handleScroll('down', 10);
      expect(area.scrollOffset).toBe(0);
    });
  });

  describe('CSS 样式文本', () => {
    it('应正确处理带 ANSI 颜色的文本', () => {
      const area = new OutputArea();
      // 模拟 chalk 格式化的文本（绿色文本）
      const greenText = '\x1b[32mGreen\x1b[39m';
      area.append([greenText]);
      const screen = createScreen(3, 40);
      const pool = createStylePool();

      area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 3 });

      // 字符应正确写入
      expect(screen.getCell(0, 0).char).toBe('G');
      expect(screen.getCell(1, 0).char).toBe('r');
      expect(screen.getCell(2, 0).char).toBe('e');
      expect(screen.getCell(3, 0).char).toBe('e');
      expect(screen.getCell(4, 0).char).toBe('n');
    });
  });

  describe('wrapTextWithAnsi 换行交互', () => {
    it('换行后的行应正确渲染到 Screen', () => {
      const area = new OutputArea();
      const longLine = `Hello World ${'X'.repeat(50)}`;
      area.append([longLine]);

      const screen = createScreen(3, 20);
      const pool = createStylePool();
      area.renderToScreen(screen, pool, { x: 0, y: 0, width: 20, height: 3 });

      // 第 0 行应有 20 个可见字符 + 换行到第 1 行
      const line0Chars: string[] = [];
      for (let c = 0; c < 20; c++) {
        line0Chars.push(screen.getCell(c, 0).char);
      }
      // 第 0 行完整（不多不少 20 个）
      expect(line0Chars.join('').length).toBe(20);
      // 第 1 行有剩余字符
      expect(screen.getCell(0, 1).char).not.toBe('');
    });
  });

  // ===========================================================================
  // 选择管理测试
  // ===========================================================================

  describe('选择管理', () => {
    describe('handleMouseEvent + 高亮渲染', () => {
      it('左键 press+drag 应渲染选中高亮', () => {
        const area = new OutputArea();
        area.append(['Hello World']);
        const pool = createStylePool();
        const screen = createScreen(5, 40);

        // 首次 render（建立 rect 缓存）
        area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 5 });

        // press 在 col=1, drag 到 col=6 (选择 "Hello")
        area.handleMouseEvent({
          btn: 0,
          col: 1,
          row: 1,
          action: 'press',
          button: 0,
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
        });
        area.handleMouseEvent({
          btn: 32,
          col: 6,
          row: 1,
          action: 'drag',
          button: 0,
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
        });

        // 第二次 render（应渲染高亮）
        const screen2 = createScreen(5, 40);
        area.renderToScreen(screen2, pool, { x: 0, y: 0, width: 40, height: 5 });

        // 未选中字符 styleId 应为 0（默认）
        expect(screen2.getCell(5, 0).styleId).toBe(0);

        // 选中范围: char 0-4 (H,e,l,l,o) → 注意 withSelectionBg(0) 内联一个新样式
        // 验证这些 cell 的 styleId 不为 0（有选中背景）
        for (let c = 0; c < 5; c++) {
          const cell = screen2.getCell(c, 0);
          expect(cell.styleId).not.toBe(0);
          expect(cell.char).toBe('Hello'[c]);
        }
      });

      it('无选择时 styleId 应为 0', () => {
        const area = new OutputArea();
        area.append(['Hello']);
        const pool = createStylePool();
        const screen = createScreen(5, 40);

        area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 5 });

        // 所有有内容的 cell styleId 应为 0（无样式）
        for (let c = 0; c < 5; c++) {
          expect(screen.getCell(c, 0).styleId).toBe(0);
        }
      });

      it('选择不应改变 cell 字符内容', () => {
        const area = new OutputArea();
        area.append(['Hello World']);
        const pool = createStylePool();
        const screen = createScreen(5, 40);
        area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 5 });

        // 记录正常渲染的字符
        const charsBefore: string[] = [];
        for (let c = 0; c < 11; c++) {
          charsBefore.push(screen.getCell(c, 0).char);
        }

        // 选择 + 重新渲染
        area.handleMouseEvent({
          btn: 0,
          col: 1,
          row: 1,
          action: 'press',
          button: 0,
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
        });
        area.handleMouseEvent({
          btn: 32,
          col: 6,
          row: 1,
          action: 'drag',
          button: 0,
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
        });
        const screen2 = createScreen(5, 40);
        area.renderToScreen(screen2, pool, { x: 0, y: 0, width: 40, height: 5 });

        // 字符内容不应改变
        for (let c = 0; c < 11; c++) {
          expect(screen2.getCell(c, 0).char).toBe(charsBefore[c]);
        }
      });

      it('release 后再次 press 应更新选择位置', () => {
        const area = new OutputArea();
        area.append(['Hello World']);
        const pool = createStylePool();

        // 第一次选择 "Hello"
        let screen = createScreen(5, 40);
        area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 5 });
        area.handleMouseEvent({
          btn: 0,
          col: 1,
          row: 1,
          action: 'press',
          button: 0,
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
        });
        area.handleMouseEvent({
          btn: 32,
          col: 6,
          row: 1,
          action: 'drag',
          button: 0,
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
        });
        area.handleMouseEvent({
          btn: 0,
          col: 6,
          row: 1,
          action: 'release',
          button: 0,
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
        });

        // 第二次选择 "World" (col 7-11)
        area.handleMouseEvent({
          btn: 0,
          col: 7,
          row: 1,
          action: 'press',
          button: 0,
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
        });
        area.handleMouseEvent({
          btn: 32,
          col: 12,
          row: 1,
          action: 'drag',
          button: 0,
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
        });
        screen = createScreen(5, 40);
        area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 5 });

        // "Hello" 不应高亮（旧选择被清除）
        for (let c = 0; c < 5; c++) {
          expect(screen.getCell(c, 0).styleId).toBe(0);
        }
        // "World" 应高亮
        for (let c = 6; c < 11; c++) {
          expect(screen.getCell(c, 0).styleId).not.toBe(0);
        }
      });

      it('非左键事件应被忽略（无高亮）', () => {
        const area = new OutputArea();
        area.append(['Hello']);
        const pool = createStylePool();
        const screen = createScreen(5, 40);

        area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 5 });

        // 右键 press
        area.handleMouseEvent({
          btn: 2,
          col: 1,
          row: 1,
          action: 'press',
          button: 2,
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
        });

        // 重新渲染
        const screen2 = createScreen(5, 40);
        area.renderToScreen(screen2, pool, { x: 0, y: 0, width: 40, height: 5 });

        // 不应有高亮
        for (let c = 0; c < 5; c++) {
          expect(screen2.getCell(c, 0).styleId).toBe(0);
        }
      });

      it('终端 resize 应清除选择', () => {
        const area = new OutputArea();
        area.append(['Hello World']);
        const pool = createStylePool();

        // 第一次 render（width=40）
        let screen = createScreen(5, 40);
        area.renderToScreen(screen, pool, { x: 0, y: 0, width: 40, height: 5 });
        area.handleMouseEvent({
          btn: 0,
          col: 1,
          row: 1,
          action: 'press',
          button: 0,
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
        });
        area.handleMouseEvent({
          btn: 32,
          col: 6,
          row: 1,
          action: 'drag',
          button: 0,
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
        });

        // resize → width 从 40 → 80
        screen = createScreen(5, 80);
        area.renderToScreen(screen, pool, { x: 0, y: 0, width: 80, height: 5 });

        // resize 后不应有高亮
        for (let c = 0; c < 11; c++) {
          expect(screen.getCell(c, 0).styleId).toBe(0);
        }
      });

      it('选择跨越换行的长文本应正确高亮', () => {
        const area = new OutputArea();
        // 30 个字符在 20 列宽下需要 2 个显示行
        area.append([`${'A'.repeat(15)}${'B'.repeat(15)}`]);
        const pool = createStylePool();

        // 以 20 列宽渲染
        const screen = createScreen(5, 20);
        area.renderToScreen(screen, pool, { x: 0, y: 0, width: 20, height: 5 });

        // 选择第 1 行的后 10 个 A 到第 2 行的前 5 个 B
        // col 11 = 第 1 行第 11 个字符（0-based: 10），对应 offset 10
        // col 6 = 第 2 行第 6 个字符（0-based: 5），对应 offset 20+5=25
        area.handleMouseEvent({
          btn: 0,
          col: 11,
          row: 1,
          action: 'press',
          button: 0,
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
        });
        area.handleMouseEvent({
          btn: 32,
          col: 6,
          row: 2,
          action: 'drag',
          button: 0,
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
        });

        const screen2 = createScreen(5, 20);
        area.renderToScreen(screen2, pool, { x: 0, y: 0, width: 20, height: 5 });

        // 第 0-9 行: 前 10 个 A 不应高亮
        for (let c = 0; c < 10; c++) {
          expect(screen2.getCell(c, 0).styleId).toBe(0);
        }
        // 第 10-19 列: 后 5 个 A 应高亮
        for (let c = 10; c < 15; c++) {
          expect(screen2.getCell(c, 0).styleId).not.toBe(0);
        }
        // 第 1 行 0-4 列: 前 5 个 B 应高亮
        for (let c = 0; c < 5; c++) {
          expect(screen2.getCell(c, 1).styleId).not.toBe(0);
        }
        // 第 1 行 5-19 列: 后 10 个 B 不应高亮
        for (let c = 5; c < 20; c++) {
          expect(screen2.getCell(c, 1).styleId).toBe(0);
        }
      });
    });
  });
});
