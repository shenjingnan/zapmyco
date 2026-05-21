import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// 使用 vi.hoisted 避免 TDZ — mock factory 中可用
const { getHomedirPath, setHomedirPath } = vi.hoisted(() => {
  let _path = '';
  return {
    getHomedirPath: () => _path,
    setHomedirPath: (p: string) => {
      _path = p;
    },
  };
});

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: vi.fn(() => {
      const override = getHomedirPath();
      if (override) return override;
      return actual.tmpdir(); // 默认使用 tmpdir 避免污染用户目录
    }),
  };
});

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
      await store.add('user', '新内容');
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
  let tmpDir: string;

  function createTool() {
    return createMemoryTool();
  }

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'zapmyco-memory-tool-'));
    setHomedirPath(tmpDir);
  });

  afterAll(() => {
    setHomedirPath('');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('工具定义', () => {
    it('应该有正确的 id', () => {
      const tool = createTool();
      expect(tool.id).toBe('Memory');
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

  describe('action="read"', () => {
    it('有记忆内容时应返回内容', async () => {
      const tool = createTool();
      // 通过 tool 添加记忆
      await tool.execute('setup', {
        action: 'add',
        type: 'user',
        content: '测试读取内容',
      });
      const result = await tool.execute('test-2', { action: 'read', type: 'user' });
      const text = result.content?.[0]?.text ?? '';
      expect(text).toContain('测试读取内容');
    });
  });

  describe('action="add"', () => {
    it('缺少 content 参数应返回错误', async () => {
      const tool = createTool();
      const result = await tool.execute('test-1', { action: 'add', type: 'user' });
      const text = result.content?.[0]?.text ?? '';
      expect(text).toContain('请提供 content 参数');
      // biome-ignore lint/suspicious/noExplicitAny: details 是联合类型，测试中简化处理
      expect((result.details as any).error).toContain('content 参数为空');
    });

    it('添加成功应返回保存结果', async () => {
      const tool = createTool();
      const uniqueContent = `项目使用 Vitest 测试框架_${Date.now()}`;
      const result = await tool.execute('test-2', {
        action: 'add',
        type: 'project',
        content: uniqueContent,
      });
      const text = result.content?.[0]?.text ?? '';
      expect(text).toContain('已保存到项目上下文');
      expect(text).toContain(uniqueContent);
    });
  });

  describe('action="remove"', () => {
    it('缺少 old_content 参数应返回错误', async () => {
      const tool = createTool();
      const result = await tool.execute('test-1', { action: 'remove', type: 'user' });
      const text = result.content?.[0]?.text ?? '';
      expect(text).toContain('请提供 old_content 参数');
    });

    it('删除成功应返回结果', async () => {
      const tool = createTool();
      const uniqueContent = `唯一待删除内容_${Date.now()}`;
      await tool.execute('setup', {
        action: 'add',
        type: 'user',
        content: uniqueContent,
      });
      const result = await tool.execute('test-2', {
        action: 'remove',
        type: 'user',
        old_content: uniqueContent,
      });
      const text = result.content?.[0]?.text ?? '';
      expect(text).toContain('已从用户画像删除匹配条目');
    });

    it('多项匹配时应返回错误', async () => {
      const tool = createTool();
      await tool.execute('setup-1', {
        action: 'add',
        type: 'user',
        content: '喜欢 TypeScript',
      });
      await tool.execute('setup-2', {
        action: 'add',
        type: 'user',
        content: '喜欢 Python',
      });
      const result = await tool.execute('test-3', {
        action: 'remove',
        type: 'user',
        old_content: '喜欢',
      });
      const text = result.content?.[0]?.text ?? '';
      expect(text).toContain('[删除失败]');
      expect(text).toContain('找到 2 个匹配项');
    });

    it('删除不存在的内容应返回错误', async () => {
      const tool = createTool();
      const result = await tool.execute('test-3', {
        action: 'remove',
        type: 'user',
        old_content: '不存在的内容xyz123',
      });
      const text = result.content?.[0]?.text ?? '';
      expect(text).toContain('[删除失败]');
    });
  });

  describe('action="list"', () => {
    it('应返回 MEMORY.md 索引内容', async () => {
      const tool = createTool();
      const result = await tool.execute('test-1', { action: 'list' });
      const text = result.content?.[0]?.text ?? '';
      expect(text).toContain('# Memory Index');
      expect(text).toContain('user.md');
    });
  });

  describe('不支持的 action', () => {
    it('应该返回错误', async () => {
      const tool = createTool();
      // biome-ignore lint/suspicious/noExplicitAny: invalid action for test
      const result = await tool.execute('test-id', { action: 'invalid' } as any);
      const text = result.content?.[0]?.text ?? '';
      expect(text).toContain('不支持的操作');
    });
  });
});
