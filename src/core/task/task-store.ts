/**
 * TaskStore — Agent 任务项持久化存储
 *
 * 内存 Map + JSON 文件双写，支持跨会话恢复。
 * 参考 Hermes-Agent 的单工具 TodoStore 设计和 Claude Code 的文件持久化方案。
 *
 * @module core/task/task-store
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TaskItem, TaskItemStatus, TaskManageSummary } from './types';

// ============ 路径工具 ============

/** 获取当前工作目录的短哈希（用于区分不同项目的任务列表） */
function getCwdHash(): string {
  return createHash('sha256').update(process.cwd()).digest('hex').slice(0, 12);
}

/** 获取任务文件存储路径 */
function getTaskFilePath(): string {
  const dir = join(homedir(), '.zapmyco', 'tasks');
  return join(dir, `${getCwdHash()}.json`);
}

/** 确保存储目录存在 */
function ensureTaskDir(): void {
  const filePath = getTaskFilePath();
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
}

// ============ TaskStore ============

export class TaskStore {
  private tasks: Map<string, TaskItem> = new Map();

  // ============ 读写操作 ============

  /** 读取完整任务列表 */
  read(): TaskItem[] {
    return Array.from(this.tasks.values());
  }

  /** 获取摘要统计 */
  summary(): TaskManageSummary {
    let pending = 0;
    let inProgress = 0;
    let completed = 0;
    let cancelled = 0;

    for (const task of this.tasks.values()) {
      switch (task.status) {
        case 'pending':
          pending++;
          break;
        case 'in_progress':
          inProgress++;
          break;
        case 'completed':
          completed++;
          break;
        case 'cancelled':
          cancelled++;
          break;
      }
    }

    return {
      total: this.tasks.size,
      pending,
      in_progress: inProgress,
      completed,
      cancelled,
    };
  }

  /** 获取活跃任务（pending + in_progress），用于上下文压缩后注入 */
  getActiveTasks(): TaskItem[] {
    const result: TaskItem[] = [];
    for (const task of this.tasks.values()) {
      if (task.status === 'pending' || task.status === 'in_progress') {
        result.push(task);
      }
    }
    return result;
  }

  /** 检查是否有任务 */
  hasItems(): boolean {
    return this.tasks.size > 0;
  }

  // ============ 写操作 ============

  /**
   * 全量替换任务列表
   *
   * @param items - 新任务列表
   * @param merge - true=按 ID 合并，false=全量替换
   * @returns 校验错误信息（如果有）
   */
  write(
    items: Array<{
      id: string;
      subject: string;
      description?: string;
      status: TaskItemStatus;
    }>,
    merge = false
  ): string | null {
    const now = Date.now();
    const newTasks = new Map<string, TaskItem>();
    let inProgressCount = 0;

    // Step 1: 合并已有任务（merge 模式）
    if (merge) {
      for (const [id, existing] of this.tasks) {
        // 跳过 terminal 状态的任务（merge 模式下保留）
        newTasks.set(id, { ...existing });
        if (existing.status === 'in_progress') {
          inProgressCount++;
        }
      }
    }

    // Step 2: 处理传入的任务项
    for (const item of items) {
      // 查找已有任务：merge 模式下查 newTasks（已含旧任务），非 merge 模式查 this.tasks
      const existing = merge
        ? newTasks.get(item.id)
        : (this.tasks.get(item.id) ?? newTasks.get(item.id));

      // 校验：terminal 状态不可修改
      if (existing && (existing.status === 'completed' || existing.status === 'cancelled')) {
        // 跳过 terminal 状态的任务（merge 模式下静默忽略）
        if (merge) {
          continue;
        }
        return `任务 "${item.id}" 已处于终态 (${existing.status})，不可修改`;
      }

      // 统计 in_progress 数
      if (item.status === 'in_progress') {
        inProgressCount++;
      }

      const taskItem: TaskItem = {
        id: item.id,
        subject: item.subject,
        status: item.status,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      if (item.description !== undefined) {
        taskItem.description = item.description;
      }

      newTasks.set(item.id, taskItem);
    }

    // Step 3: 校验约束 — 最多 1 个 in_progress
    if (inProgressCount > 1) {
      return `不允许同时有 ${inProgressCount} 个进行中的任务，请先将当前任务完成或取消后再开始新任务`;
    }

    this.tasks = newTasks;
    this.persist();
    return null;
  }

  /**
   * 增量更新单个任务
   *
   * @param id - 任务 ID
   * @param updates - 要更新的字段
   * @returns 校验错误信息（如果有）
   */
  update(
    id: string,
    updates: {
      subject?: string;
      description?: string;
      status?: TaskItemStatus;
    }
  ): string | null {
    const existing = this.tasks.get(id);
    if (!existing) {
      return `任务 "${id}" 不存在`;
    }

    // 校验：terminal 状态不可修改
    if (existing.status === 'completed' || existing.status === 'cancelled') {
      return `任务 "${id}" 已处于终态 (${existing.status})，不可修改`;
    }

    // 校验：设为 in_progress 时检查冲突
    if (updates.status === 'in_progress') {
      for (const task of this.tasks.values()) {
        if (task.id !== id && task.status === 'in_progress') {
          return `已有进行中的任务 "${task.id}: ${task.subject}"，请先将它完成或取消后再开始新任务`;
        }
      }
    }

    // 应用更新
    const updated: TaskItem = {
      ...existing,
      ...(updates.subject !== undefined ? { subject: updates.subject } : {}),
      ...(updates.description !== undefined ? { description: updates.description } : {}),
      ...(updates.status !== undefined ? { status: updates.status } : {}),
      updatedAt: Date.now(),
    };

    this.tasks.set(id, updated);
    this.persist();
    return null;
  }

  /** 清空所有任务 */
  clear(): void {
    this.tasks.clear();
    this.persist();
  }

  // ============ 持久化 ============

  /** 持久化到文件系统 */
  private persist(): void {
    try {
      ensureTaskDir();
      const data = JSON.stringify(this.read(), null, 2);
      writeFileSync(getTaskFilePath(), data, 'utf-8');
    } catch {
      // 静默失败：持久化错误不应中断 Agent 工作流
    }
  }

  /** 从文件系统恢复 */
  load(): boolean {
    try {
      const filePath = getTaskFilePath();
      const raw = readFileSync(filePath, 'utf-8');
      const data: unknown = JSON.parse(raw);

      if (!Array.isArray(data)) {
        return false;
      }

      const items = data as Array<Partial<TaskItem>>;
      this.tasks.clear();

      for (const item of items) {
        if (
          typeof item.id === 'string' &&
          typeof item.subject === 'string' &&
          typeof item.status === 'string' &&
          ['pending', 'in_progress', 'completed', 'cancelled'].includes(item.status)
        ) {
          const taskItem: TaskItem = {
            id: item.id,
            subject: item.subject,
            status: item.status as TaskItemStatus,
            createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
            updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
          };
          if (typeof item.description === 'string') {
            taskItem.description = item.description;
          }
          this.tasks.set(item.id, taskItem);
        }
      }

      return true;
    } catch {
      // 文件不存在或损坏，从空开始
      return false;
    }
  }

  /**
   * 格式化活跃任务为 LLM 注入文本
   *
   * 参考 Hermes-Agent 的 format_for_injection 设计，
   * 在上下文压缩后将活跃任务重新注入给模型。
   */
  formatForInjection(): string | null {
    const active = this.getActiveTasks();
    if (active.length === 0) {
      return null;
    }

    const lines: string[] = ['## 当前任务列表'];
    for (const task of active) {
      const marker = task.status === 'in_progress' ? '▶' : '○';
      lines.push(`  ${marker} [${task.id}] ${task.subject}`);
    }
    return lines.join('\n');
  }
}
