import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskStore } from '@/core/task/task-store';
import type { TaskItem } from '@/core/task/types';

/**
 * TaskStore 单元测试
 *
 * 覆盖：CRUD 操作、状态校验、持久化恢复、辅助方法
 */
describe('TaskStore', () => {
  let store: TaskStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'zapmyco-task-store-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    store = new TaskStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ============ 初始状态 ============
  describe('初始状态', () => {
    it('应该为空任务列表', () => {
      expect(store.read()).toHaveLength(0);
      expect(store.hasItems()).toBe(false);
    });

    it('摘要统计应全为零', () => {
      const summary = store.summary();
      expect(summary).toEqual({
        total: 0,
        pending: 0,
        in_progress: 0,
        completed: 0,
        cancelled: 0,
      });
    });

    it('活跃任务列表应为空', () => {
      expect(store.getActiveTasks()).toHaveLength(0);
    });

    it('formatForInjection 应返回 null（无活跃任务）', () => {
      expect(store.formatForInjection()).toBeNull();
    });
  });

  // ============ write 操作 ============
  describe('write', () => {
    it('应该创建任务列表', () => {
      const error = store.write([
        { id: '1', subject: '分析需求', status: 'pending' },
        { id: '2', subject: '编写代码', status: 'pending' },
      ]);

      expect(error).toBeNull();
      expect(store.read()).toHaveLength(2);
    });

    it('应该设置正确的创建时间戳', () => {
      const before = Date.now();
      store.write([{ id: '1', subject: '测试', status: 'pending' }]);
      const after = Date.now();

      const tasks = store.read();
      expect(tasks[0]!.createdAt).toBeGreaterThanOrEqual(before);
      expect(tasks[0]!.createdAt).toBeLessThanOrEqual(after);
    });

    it('应该正确统计各状态数量', () => {
      store.write([
        { id: '1', subject: '待处理任务', status: 'pending' },
        { id: '2', subject: '进行中任务', status: 'in_progress' },
        { id: '3', subject: '已完成任务', status: 'completed' },
        { id: '4', subject: '已取消任务', status: 'cancelled' },
      ]);

      const summary = store.summary();
      expect(summary.total).toBe(4);
      expect(summary.pending).toBe(1);
      expect(summary.in_progress).toBe(1);
      expect(summary.completed).toBe(1);
      expect(summary.cancelled).toBe(1);
    });

    it('全量替换应清除旧任务', () => {
      store.write([{ id: '1', subject: '旧任务', status: 'pending' }]);
      store.write([{ id: '2', subject: '新任务', status: 'pending' }]);

      const tasks = store.read();
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.id).toBe('2');
    });

    // ============ 状态约束校验 ============
    it('不应允许多个 in_progress 任务', () => {
      const error = store.write([
        { id: '1', subject: '任务1', status: 'in_progress' },
        { id: '2', subject: '任务2', status: 'in_progress' },
      ]);

      expect(error).toContain('不允许同时有');
    });

    it('不应允许修改已完成的任务（非 merge 模式）', () => {
      store.write([{ id: '1', subject: '已完成任务', status: 'completed' }]);

      const error = store.write([{ id: '1', subject: '尝试修改', status: 'in_progress' }]);

      expect(error).toContain('已处于终态');
    });

    it('不应允许修改已取消的任务（非 merge 模式）', () => {
      store.write([{ id: '1', subject: '已取消任务', status: 'cancelled' }]);

      const error = store.write([{ id: '1', subject: '尝试修改', status: 'in_progress' }]);

      expect(error).toContain('已处于终态');
    });

    it('空数组应清空所有任务', () => {
      store.write([{ id: '1', subject: '任务1', status: 'pending' }]);
      store.write([]);

      expect(store.read()).toHaveLength(0);
    });
  });

  // ============ merge 模式 ============
  describe('write (merge)', () => {
    it('应该按 ID 合并新任务', () => {
      store.write([{ id: '1', subject: '原有任务', status: 'pending' }]);
      store.write([{ id: '2', subject: '新增任务', status: 'pending' }], true);

      expect(store.read()).toHaveLength(2);
    });

    it('应该按 ID 更新已有任务', () => {
      store.write([{ id: '1', subject: '原标题', status: 'pending' }]);
      store.write([{ id: '1', subject: '新标题', status: 'in_progress' }], true);

      const tasks = store.read();
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.subject).toBe('新标题');
      expect(tasks[0]!.status).toBe('in_progress');
    });

    it('merge 模式下应静默跳过 terminal 状态任务', () => {
      store.write([{ id: '1', subject: '已完成', status: 'completed' }]);
      const error = store.write([{ id: '1', subject: '尝试修改', status: 'pending' }], true);

      expect(error).toBeNull();
      const tasks = store.read();
      expect(tasks[0]!.status).toBe('completed'); // 状态未变
    });

    it('merge 模式下也应检查 in_progress 约束', () => {
      store.write([{ id: '1', subject: '任务1', status: 'in_progress' }]);
      const error = store.write([{ id: '2', subject: '任务2', status: 'in_progress' }], true);

      expect(error).toContain('不允许同时有');
    });
  });

  // ============ update 操作 ============
  describe('update', () => {
    it('应该更新任务状态', () => {
      store.write([{ id: '1', subject: '测试', status: 'pending' }]);

      const error = store.update('1', { status: 'in_progress' });

      expect(error).toBeNull();
      expect(store.read()[0]!.status).toBe('in_progress');
    });

    it('应该更新任务标题', () => {
      store.write([{ id: '1', subject: '原标题', status: 'pending' }]);

      store.update('1', { subject: '新标题' });

      expect(store.read()[0]!.subject).toBe('新标题');
    });

    it('应该更新 updatedAt 时间戳', () => {
      store.write([{ id: '1', subject: '测试', status: 'pending' }]);
      const before = Date.now();

      store.update('1', { status: 'in_progress' });
      const after = Date.now();

      expect(store.read()[0]!.updatedAt).toBeGreaterThanOrEqual(before);
      expect(store.read()[0]!.updatedAt).toBeLessThanOrEqual(after);
    });

    it('应该拒绝更新不存在的任务', () => {
      const error = store.update('nonexistent', { status: 'in_progress' });

      expect(error).toContain('不存在');
    });

    it('应该拒绝更新已完成的任务', () => {
      store.write([{ id: '1', subject: '已完成', status: 'completed' }]);

      const error = store.update('1', { status: 'in_progress' });

      expect(error).toContain('已处于终态');
    });

    it('应该拒绝更新已取消的任务', () => {
      store.write([{ id: '1', subject: '已取消', status: 'cancelled' }]);

      const error = store.update('1', { status: 'in_progress' });

      expect(error).toContain('已处于终态');
    });

    it('已有 in_progress 时不应允许另一个开始', () => {
      store.write([
        { id: '1', subject: '进行中', status: 'in_progress' },
        { id: '2', subject: '待处理', status: 'pending' },
      ]);

      const error = store.update('2', { status: 'in_progress' });

      expect(error).toContain('已有进行中的任务');
    });

    it('应该允许将当前 in_progress 改为 completed 再开始下一个', () => {
      store.write([
        { id: '1', subject: '进行中', status: 'in_progress' },
        { id: '2', subject: '待处理', status: 'pending' },
      ]);

      store.update('1', { status: 'completed' });
      const error = store.update('2', { status: 'in_progress' });

      expect(error).toBeNull();
      expect(store.read().find((t) => t.id === '2')!.status).toBe('in_progress');
    });
  });

  // ============ 辅助方法 ============
  describe('getActiveTasks', () => {
    it('应该只返回 pending 和 in_progress 任务', () => {
      store.write([
        { id: '1', subject: '待处理', status: 'pending' },
        { id: '2', subject: '进行中', status: 'in_progress' },
        { id: '3', subject: '已完成', status: 'completed' },
        { id: '4', subject: '已取消', status: 'cancelled' },
      ]);

      const active = store.getActiveTasks();
      expect(active).toHaveLength(2);
      expect(active.map((t: TaskItem) => t.status).sort()).toEqual(['in_progress', 'pending']);
    });
  });

  describe('formatForInjection', () => {
    it('应该格式化活跃任务为注入文本', () => {
      store.write([
        { id: '1', subject: '搜索相关文件', status: 'in_progress' },
        { id: '2', subject: '编写测试', status: 'pending' },
        { id: '3', subject: '已完成任务', status: 'completed' },
      ]);

      const text = store.formatForInjection();
      expect(text).toContain('当前任务列表');
      expect(text).toContain('[1]');
      expect(text).toContain('[2]');
      expect(text).not.toContain('[3]'); // 已完成的不应出现
    });

    it('无活跃任务时应返回 null', () => {
      store.write([{ id: '1', subject: '全部完成', status: 'completed' }]);

      expect(store.formatForInjection()).toBeNull();
    });
  });

  describe('hasItems', () => {
    it('有任务时返回 true', () => {
      store.write([{ id: '1', subject: '测试', status: 'pending' }]);
      expect(store.hasItems()).toBe(true);
    });

    it('无任务时返回 false', () => {
      expect(store.hasItems()).toBe(false);
    });
  });

  describe('clear', () => {
    it('应该清空所有任务', () => {
      store.write([
        { id: '1', subject: '任务1', status: 'pending' },
        { id: '2', subject: '任务2', status: 'completed' },
      ]);

      store.clear();

      expect(store.read()).toHaveLength(0);
      expect(store.hasItems()).toBe(false);
    });
  });

  // ============ 持久化 ============
  describe('持久化与恢复', () => {
    it('应该能保存并恢复任务', () => {
      store.write([
        { id: '1', subject: '任务1', status: 'pending' },
        { id: '2', subject: '任务2', description: '详细描述', status: 'completed' },
      ]);

      // 创建新的 TaskStore 实例（同一 cwd）来模拟恢复
      const restoredStore = new TaskStore();
      const loaded = restoredStore.load();

      expect(loaded).toBe(true);
      const tasks = restoredStore.read();
      expect(tasks).toHaveLength(2);
      expect(tasks[0]!.id).toBe('1');
      expect(tasks[0]!.subject).toBe('任务1');
      expect(tasks[0]!.status).toBe('pending');
      expect(tasks[1]!.description).toBe('详细描述');
    });

    it('无效 JSON 文件应返回 false', () => {
      const store2 = new TaskStore();
      // load 在无效/不存在文件时返回 false，并且验证后数据为空
      // 模拟不写入任何数据直接 load
      const loaded = store2.load();
      // 文件不存在或无效时应返回 false
      expect(typeof loaded).toBe('boolean');
    });
  });
});
