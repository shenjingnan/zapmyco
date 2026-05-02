import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryTool, MemoryStore } from '@/cli/repl/tools/memory-tool';

/**
 * MemoryStore 和 memory 工具单元测试
 *
 * 覆盖: MemoryStore CRUD、工具定义、参数校验、边界场景
 */
describe('MemoryStore', () => {
  let store: MemoryStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'zapmyco-memory-'));
    store = new MemoryStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('initialize', () => {
    it('应该创建目录和默认文件', async () => {
      await store.initialize();
      const fs = await import('node:fs/promises');
      const files = await fs.readdir(join(tmpDir, '.zapmyco', 'memory'));
      expect(files).toContain('MEMORY.md');
      expect(files).toContain('user.md');
      expect(files).toContain('project.md');
      expect(files).toContain('session.md');
    });

    it('重复调用 initialize 应该是幂等的', async () => {
      await store.initialize();
      await store.initialize();
      // 不应抛出异常
    });
  });

  describe('add', () => {
    it('应该成功添加一条记忆条目', async () => {
      const result = await store.add('user', '用户喜欢使用中文');
      expect(result.ok).toBe(true);
    });

    it('应该拒绝空内容', async () => {
      const result = await store.add('user', '');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('不能为空');
    });

    it('应该拒绝超长内容', async () => {
      const longContent = 'x'.repeat(2001);
      const result = await store.add('user', longContent);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('过长');
    });

    it('应该对重复内容去重', async () => {
      await store.add('user', '用户喜欢使用中文');
      const result = await store.add('user', '用户喜欢使用中文');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('已存在');
    });
  });

  describe('read', () => {
    it('应该读取已保存的记忆内容', async () => {
      await store.add('user', '用户喜欢使用中文');
      const content = await store.read('user');
      expect(content).toContain('用户喜欢使用中文');
    });

    it('空记忆文件应该返回文件头', async () => {
      await store.initialize();
      const content = await store.read('project');
      expect(content).toContain('# 项目上下文');
    });
  });

  describe('remove', () => {
    it('应该成功删除匹配的条目', async () => {
      await store.add('user', '用户喜欢使用中文');
      const result = await store.remove('user', '用户喜欢使用中文');
      expect(result.ok).toBe(true);

      const content = await store.read('user');
      expect(content).not.toContain('用户喜欢使用中文');
    });

    it('应该拒绝空的 old_content', async () => {
      const result = await store.remove('user', '');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('不能为空');
    });

    it('未找到匹配条目时应返回错误', async () => {
      const result = await store.remove('user', '不存在的条目');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('未找到匹配');
    });

    it('多项匹配时应返回错误并列出匹配项', async () => {
      await store.add('user', '喜欢 TypeScript');
      await store.add('user', '喜欢 Python');
      const result = await store.remove('user', '喜欢');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('找到 2 个匹配项');
    });
  });

  describe('list', () => {
    it('应该返回索引内容', async () => {
      await store.initialize();
      const content = await store.list();
      expect(content).toContain('# Memory Index');
      expect(content).toContain('user.md');
      expect(content).toContain('project.md');
      expect(content).toContain('session.md');
    });

    it('添加条目后索引应更新计数', async () => {
      await store.add('user', '测试条目');
      const content = await store.list();
      expect(content).toContain('（1 条）');
    });
  });

  describe('快照', () => {
    it('freezeSnapshot 应冻结当前内容', async () => {
      await store.add('user', '快照测试');
      await store.freezeSnapshot();
      const snapshot = store.getSnapshot('user');
      expect(snapshot).toContain('快照测试');
    });

    it('快照冻结后的写入不影响快照', async () => {
      await store.add('user', '旧内容');
      await store.freezeSnapshot();

      // 写入新内容
      await store.add('user', '新内容');

      // 快照应该仍是冻结时的内容
      const snapshot = store.getSnapshot('user');
      expect(snapshot).toContain('旧内容');
      expect(snapshot).not.toContain('新内容');
    });

    it('getSnapshot 不传 type 应返回所有类型摘要', async () => {
      await store.add('user', '用户内容');
      await store.freezeSnapshot();
      const all = store.getSnapshot();
      expect(all).toContain('用户画像');
    });
  });
});

describe('memory 工具', () => {
  let store: MemoryStore;
  let tmpDir: string;

  function createTool() {
    return createMemoryTool();
  }

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'zapmyco-memory-tool-'));
    store = new MemoryStore(tmpDir);
    // 替换全局 store（hack: 通过 import 的 getMemoryStore）
    await store.initialize();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // 重新导入以获取使用临时目录的 store
  // 注：由于 memory 工具使用全局单例，这里的测试验证工具定义结构为主

  describe('工具定义', () => {
    it('应该有正确的 id', () => {
      const tool = createTool();
      expect(tool.id).toBe('memory');
    });

    it('应该有正确的 label', () => {
      const tool = createTool();
      expect(tool.label).toBe('记忆管理');
    });

    it('应该定义 parameters schema 含 4 个 action', () => {
      const tool = createTool();
      expect(tool.parameters).toBeDefined();
      if (
        tool.parameters &&
        typeof tool.parameters === 'object' &&
        'properties' in tool.parameters
      ) {
        const props = tool.parameters.properties as Record<string, unknown>;
        expect(props.action).toBeDefined();
        expect(props.type).toBeDefined();
        expect(props.content).toBeDefined();
        expect(props.old_content).toBeDefined();
      }
    });
  });

  describe('不支持的 action', () => {
    it('应该返回错误', async () => {
      const tool = createTool();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await tool.execute('test-id', { action: 'invalid' as any });
      const text = result.content?.[0]?.text ?? '';
      expect(text).toContain('不支持的操作');
    });
  });
});
