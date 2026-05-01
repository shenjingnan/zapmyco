/**
 * process 工具实现 — 后台进程管理
 *
 * 管理 exec 工具启动的后台进程：
 * - list: 列出所有后台进程
 * - poll: 检查状态 + 获取新输出
 * - log: 获取完整或部分输出
 * - wait: 等待进程完成
 * - kill: 终止进程
 * - write: 向 stdin 写入数据
 * - submit: 向 stdin 写入数据 + 换行
 *
 * 参考 Hermes (process_registry.py) 和 OpenClaw (bash-tools.process.ts) 的设计。
 *
 * @module cli/repl/tools/shell-process
 */

import { getProcessRegistry } from './process-registry';
import type { ProcessDetails, ProcessParams } from './shell-types';

export function createProcessTool() {
  return {
    id: 'process' as const,
    label: '管理进程' as const,
    description:
      '管理后台运行的进程。支持的操作：\n' +
      '- list: 列出所有后台进程\n' +
      '- poll: 检查进程状态并获取新输出\n' +
      '- log: 获取进程完整或部分日志\n' +
      '- wait: 等待进程完成\n' +
      '- kill: 终止进程\n' +
      '- write: 向进程 stdin 写入数据\n' +
      '- submit: 向进程 stdin 写入数据并追加换行',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型: list, poll, log, wait, kill, write, submit',
          enum: ['list', 'poll', 'log', 'wait', 'kill', 'write', 'submit'],
        },
        sessionId: {
          type: 'string',
          description: '进程 session ID（除 list 外必需）',
        },
        data: {
          type: 'string',
          description: 'write/submit 时写入的数据',
        },
        offset: {
          type: 'number',
          description: 'log 时的行偏移量',
        },
        limit: {
          type: 'number',
          description: 'log 时的最大行数（默认 40）',
        },
        waitTimeout: {
          type: 'number',
          description: 'wait 时的超时（毫秒），默认无超时',
        },
      },
      required: ['action'],
    } as const,

    async execute(_toolCallId: string, params: ProcessParams) {
      const registry = getProcessRegistry();

      switch (params.action) {
        case 'list':
          return handleList(registry);
        case 'poll':
          return handlePoll(registry, params);
        case 'log':
          return handleLog(registry, params);
        case 'wait':
          return await handleWait(registry, params);
        case 'kill':
          return handleKill(registry, params);
        case 'write':
          return handleWrite(registry, params, false);
        case 'submit':
          return handleWrite(registry, params, true);
        default:
          return {
            content: [
              {
                type: 'text',
                text: `未知操作: ${params.action}。支持: list, poll, log, wait, kill, write, submit`,
              },
            ],
          };
      }
    },
  };
}

// ============ 操作处理 ============

function handleList(registry: ReturnType<typeof getProcessRegistry>) {
  const sessions = registry.list();

  if (sessions.length === 0) {
    return {
      content: [{ type: 'text', text: '(没有活动的后台进程)' }],
      details: { action: 'list', sessions: [], processCount: 0 } satisfies ProcessDetails,
    };
  }

  const lines: string[] = [`共 ${sessions.length} 个后台进程:`, ''];
  for (const s of sessions) {
    const statusIcon = statusIconMap[s.status];
    const duration = formatDuration(Date.now() - s.startTime);
    lines.push(`${statusIcon} [${s.sessionId}] ${s.status}`);
    lines.push(`   PID: ${s.pid} | 运行: ${duration} | 命令: ${truncateCommand(s.command)}`);
    lines.push('');
  }

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    details: { action: 'list', sessions, processCount: sessions.length } satisfies ProcessDetails,
  };
}

function handlePoll(registry: ReturnType<typeof getProcessRegistry>, params: ProcessParams) {
  if (!params.sessionId) {
    return { content: [{ type: 'text', text: 'poll 操作需要 sessionId 参数' }] };
  }

  const result = registry.poll(params.sessionId);
  if (!result) {
    return {
      content: [{ type: 'text', text: `进程 ${params.sessionId} 未找到` }],
    };
  }

  const { session, newOutput } = result;
  const statusIcon = statusIconMap[session.status];
  const duration = formatDuration(Date.now() - session.startTime);

  let text = `${statusIcon} [${session.sessionId}] ${session.status}\n`;
  text += `PID: ${session.pid} | 运行: ${duration}\n`;

  if (session.exitCode != null) {
    text += `退出码: ${session.exitCode}\n`;
  }

  if (newOutput) {
    text += `\n--- 新输出 ---\n${newOutput}`;
  } else if (session.status === 'running') {
    text += '\n(尚无新输出)';
  }

  return {
    content: [{ type: 'text', text }],
    details: { action: 'poll', sessionId: session.sessionId } satisfies ProcessDetails,
  };
}

function handleLog(registry: ReturnType<typeof getProcessRegistry>, params: ProcessParams) {
  if (!params.sessionId) {
    return { content: [{ type: 'text', text: 'log 操作需要 sessionId 参数' }] };
  }

  const logOptions: { offset?: number; limit?: number } = {};
  if (params.offset !== undefined) logOptions.offset = params.offset;
  if (params.limit !== undefined) logOptions.limit = params.limit;

  const result = registry.getLog(params.sessionId, logOptions);
  if (!result) {
    return {
      content: [{ type: 'text', text: `进程 ${params.sessionId} 未找到` }],
    };
  }

  const { session, output } = result;
  let text = `[${session.sessionId}] ${session.status}\n`;

  if (session.exitCode != null) {
    text += `退出码: ${session.exitCode}\n`;
  }
  text += `\n${output || '(无输出)'}`;

  return {
    content: [{ type: 'text', text }],
    details: { action: 'log', sessionId: session.sessionId } satisfies ProcessDetails,
  };
}

async function handleWait(registry: ReturnType<typeof getProcessRegistry>, params: ProcessParams) {
  if (!params.sessionId) {
    return { content: [{ type: 'text', text: 'wait 操作需要 sessionId 参数' }] };
  }

  const session = await registry.wait(params.sessionId, params.waitTimeout);

  if (!session) {
    return {
      content: [{ type: 'text', text: `进程 ${params.sessionId} 未找到` }],
    };
  }

  const duration = formatDuration(Date.now() - session.startTime);
  let text = `[${session.sessionId}] ${session.status}\n`;
  text += `总运行时间: ${duration}\n`;
  if (session.exitCode != null) {
    text += `退出码: ${session.exitCode}\n`;
  }

  return {
    content: [{ type: 'text', text }],
    details: { action: 'wait', sessionId: session.sessionId } satisfies ProcessDetails,
  };
}

function handleKill(registry: ReturnType<typeof getProcessRegistry>, params: ProcessParams) {
  if (!params.sessionId) {
    return { content: [{ type: 'text', text: 'kill 操作需要 sessionId 参数' }] };
  }

  const session = registry.kill(params.sessionId);
  if (!session) {
    return {
      content: [{ type: 'text', text: `进程 ${params.sessionId} 未找到` }],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text:
          `[${session.sessionId}] 已发送终止信号 (SIGTERM)\n` +
          `PID: ${session.pid}\n命令: ${truncateCommand(session.command)}`,
      },
    ],
    details: { action: 'kill', sessionId: session.sessionId } satisfies ProcessDetails,
  };
}

function handleWrite(
  registry: ReturnType<typeof getProcessRegistry>,
  params: ProcessParams,
  newline: boolean
) {
  if (!params.sessionId) {
    return { content: [{ type: 'text', text: 'write/submit 操作需要 sessionId 参数' }] };
  }
  if (!params.data) {
    return { content: [{ type: 'text', text: 'write/submit 操作需要 data 参数' }] };
  }

  const session = registry.write(params.sessionId, params.data, newline);
  if (!session) {
    return {
      content: [{ type: 'text', text: `进程 ${params.sessionId} 未找到` }],
    };
  }

  if (session.status !== 'running') {
    return {
      content: [
        {
          type: 'text',
          text: `Cannot write to process ${params.sessionId}: status is ${session.status}`,
        },
      ],
    };
  }

  const action = newline ? 'submit' : 'write';
  return {
    content: [
      {
        type: 'text',
        text: `已向 [${session.sessionId}] ${action === 'submit' ? '发送并提交' : '写入'}数据。`,
      },
    ],
    details: {
      action: action as ProcessDetails['action'],
      sessionId: session.sessionId,
    } satisfies ProcessDetails,
  };
}

// ============ 辅助函数 ============

const statusIconMap: Record<string, string> = {
  running: '🔄',
  exited: '✅',
  killed: '🛑',
  timeout: '⏰',
  errored: '❌',
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSec}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return `${hours}h ${remainingMin}m`;
}

function truncateCommand(command: string, maxLen: number = 80): string {
  if (command.length <= maxLen) return command;
  return command.slice(0, maxLen - 3) + '...';
}
