/**
 * exec 工具实现 — Shell 命令执行
 *
 * 功能：
 * - 前台/后台命令执行
 * - 超时控制
 * - PTY 支持（可选）
 * - 安全检查集成
 * - 输出处理（ANSI 剥离、截断、脱敏）
 *
 * 参考 Hermes (terminal_tool.py) 和 Claude Code (BashTool.tsx) 的设计。
 *
 * @module cli/repl/tools/shell-exec
 */

import { type ChildProcess, spawn } from 'node:child_process';
import * as os from 'node:os';
import { getProcessRegistry } from './process-registry';
import {
  checkCommandSecurity,
  redactSensitiveInfo,
  sanitizeEnv,
  stripAnsi,
  truncateOutput,
  validateWorkdir,
} from './shell-security';
import type { ExecDetails, ExecParams } from './shell-types';

// ============ 常量 ============

const DEFAULT_TIMEOUT_SEC = 180;
const MAX_FOREGROUND_TIMEOUT_SEC = 600;
const MAX_OUTPUT_CHARS = 100_000;
const KILL_GRACE_PERIOD_MS = 2000;

// ============ exec 工具 ============

export function createExecTool() {
  return {
    id: 'exec' as const,
    label: '执行命令' as const,
    description:
      '在本地执行 Shell 命令。支持前台/后台模式、超时控制、PTY 交互。' +
      '可用于构建、测试、git 操作、文件操作、包管理等。' +
      '当需要执行命令行操作时调用此工具，不要直接操作文件系统。' +
      '注意：危险命令（如 rm -rf /、shutdown 等）会被自动阻断。' +
      '长时间运行的任务请使用 background=true 在后台执行。',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '要执行的 Shell 命令',
        },
        workdir: {
          type: 'string',
          description: '工作目录，默认为当前项目根目录',
        },
        timeout: {
          type: 'number',
          description: `超时时间（秒），默认 ${DEFAULT_TIMEOUT_SEC}，最大 ${MAX_FOREGROUND_TIMEOUT_SEC}`,
        },
        background: {
          type: 'boolean',
          description: '是否在后台运行。长时间任务（构建、服务启动等）应设为 true',
        },
        pty: {
          type: 'boolean',
          description: '是否使用 PTY 模式（适用于交互式命令），默认 false',
        },
      },
      required: ['command'],
    } as const,

    async execute(_toolCallId: string, params: ExecParams, signal?: AbortSignal) {
      const startTime = Date.now();

      // Step 1: 安全检查
      const securityResult = checkCommandSecurity(params.command);
      if (securityResult.blocked) {
        return {
          content: [
            {
              type: 'text',
              text: formatBlockedOutput(params.command, securityResult.reason!),
            },
          ],
          details: {
            command: params.command,
            status: 'blocked',
            exitCode: -1,
            durationMs: Date.now() - startTime,
          } satisfies ExecDetails,
        };
      }

      // Step 2: 工作目录验证
      const workdirResult = validateWorkdir(params.workdir);
      if (!workdirResult.valid) {
        return {
          content: [
            {
              type: 'text',
              text: `工作目录无效: ${workdirResult.reason}`,
            },
          ],
          details: {
            command: params.command,
            status: 'error',
            exitCode: -1,
            durationMs: Date.now() - startTime,
          } satisfies ExecDetails,
        };
      }

      // Step 3: 获取 shell
      const shell = getShell();

      // Step 4: 计算超时
      const isBackground = params.background === true;
      const timeoutSec = isBackground
        ? 0
        : Math.min(params.timeout ?? DEFAULT_TIMEOUT_SEC, MAX_FOREGROUND_TIMEOUT_SEC);

      // Step 5: 环境变量清洗
      const env = sanitizeEnv();

      // Step 6: 生成子进程
      let childProcess: ChildProcess;
      try {
        childProcess = spawn(shell, ['-c', params.command], {
          cwd: workdirResult.resolved,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          // 创建新进程组，便于清理
          ...(os.platform() !== 'win32' ? { detached: false } : {}),
        });
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `进程启动失败: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: {
            command: params.command,
            status: 'error',
            exitCode: -1,
            durationMs: Date.now() - startTime,
          } satisfies ExecDetails,
        };
      }

      // Step 7: 后台模式
      if (isBackground) {
        const registry = getProcessRegistry();
        const session = registry.register(params.command, childProcess, {
          workdir: workdirResult.resolved,
        });

        return {
          content: [
            {
              type: 'text',
              text:
                `[后台进程已启动]\n` +
                `Session ID: ${session.sessionId}\n` +
                `PID: ${session.pid}\n` +
                `命令: ${params.command}\n` +
                `使用 process 工具 (action=poll) 获取状态和输出。`,
            },
          ],
          details: {
            command: params.command,
            status: 'running',
            pid: session.pid,
            sessionId: session.sessionId,
            durationMs: Date.now() - startTime,
            workdir: workdirResult.resolved,
          } satisfies ExecDetails,
        };
      }

      // Step 8: 前台执行
      try {
        const result = await runForeground(childProcess, timeoutSec, signal);
        const durationMs = Date.now() - startTime;
        const output = processOutput(
          result.stdout,
          result.stderr,
          result.exitCode,
          result.timedOut,
          result.killed
        );

        return {
          content: [{ type: 'text', text: output }],
          details: {
            command: params.command,
            status: result.timedOut
              ? 'timeout'
              : result.killed
                ? 'killed'
                : result.exitCode === 0
                  ? 'completed'
                  : 'failed',
            exitCode: result.exitCode,
            signal: result.signal,
            durationMs,
            workdir: workdirResult.resolved,
          } satisfies ExecDetails,
        };
      } catch (err) {
        const durationMs = Date.now() - startTime;
        return {
          content: [
            {
              type: 'text',
              text: `命令执行异常: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: {
            command: params.command,
            status: 'error',
            exitCode: -1,
            durationMs,
          } satisfies ExecDetails,
        };
      }
    },
  };
}

// ============ 前台执行核心逻辑 ============

interface ForegroundResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  killed: boolean;
}

function runForeground(
  childProcess: ChildProcess,
  timeoutSec: number,
  signal?: AbortSignal
): Promise<ForegroundResult> {
  return new Promise((resolve) => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let timedOut = false;
    let killed = false;
    let settled = false;

    const settle = (result: ForegroundResult) => {
      if (settled) return;
      settled = true;

      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);

      resolve(result);
    };

    // 数据捕获
    if (childProcess.stdout) {
      childProcess.stdout.on('data', (data: Buffer) => {
        stdoutChunks.push(data.toString('utf-8'));
      });
    }
    if (childProcess.stderr) {
      childProcess.stderr.on('data', (data: Buffer) => {
        stderrChunks.push(data.toString('utf-8'));
      });
    }

    // 进程退出
    childProcess.on('exit', (code, procSignal) => {
      settle({
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join(''),
        exitCode: code,
        signal: procSignal,
        timedOut,
        killed,
      });
    });

    childProcess.on('error', (err) => {
      settle({
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join('') + `\n[进程错误: ${err.message}]`,
        exitCode: -1,
        signal: null,
        timedOut: false,
        killed: false,
      });
    });

    // 超时控制
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    if (timeoutSec > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        try {
          // 杀进程组
          if (childProcess.pid && os.platform() !== 'win32') {
            try {
              process.kill(-childProcess.pid, 'SIGTERM');
            } catch {
              childProcess.kill('SIGTERM');
            }
          } else {
            childProcess.kill('SIGTERM');
          }
        } catch {
          // 进程可能已退出
        }

        killTimer = setTimeout(() => {
          killed = true;
          try {
            if (childProcess.pid && os.platform() !== 'win32') {
              try {
                process.kill(-childProcess.pid, 'SIGKILL');
              } catch {
                childProcess.kill('SIGKILL');
              }
            } else {
              childProcess.kill('SIGKILL');
            }
          } catch {
            // 忽略
          }
        }, KILL_GRACE_PERIOD_MS);
      }, timeoutSec * 1000);
    }

    // AbortSignal 支持
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          try {
            if (childProcess.pid && os.platform() !== 'win32') {
              process.kill(-childProcess.pid, 'SIGTERM');
            } else {
              childProcess.kill('SIGTERM');
            }
          } catch {
            // 忽略
          }
        },
        { once: true }
      );
    }
  });
}

// ============ 辅助函数 ============

function getShell(): string {
  if (os.platform() === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

function processOutput(
  stdout: string,
  stderr: string,
  exitCode: number | null,
  timedOut: boolean,
  killed: boolean
): string {
  // 合并 stdout 和 stderr
  let output = stdout;
  if (stderr) {
    output += (output ? '\n' : '') + stderr;
  }

  // ANSI 剥离
  output = stripAnsi(output);

  // 敏感信息脱敏
  output = redactSensitiveInfo(output);

  // 截断
  output = truncateOutput(output, MAX_OUTPUT_CHARS);

  // 状态信息尾部追加
  if (timedOut) {
    output += '\n\n[命令执行超时]';
  } else if (killed) {
    output += '\n\n[命令已被终止]';
  } else if (exitCode !== null && exitCode !== 0) {
    output += `\n\n(命令退出码: ${exitCode})`;
  }

  return output || '(无输出)';
}

function formatBlockedOutput(command: string, reason: string): string {
  return `[安全检查] 命令被阻断\n\n命令: ${command}\n原因: ${reason}\n\n此命令属于危险操作，已被自动拒绝执行。`;
}
