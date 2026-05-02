/**
 * Memory 系统端到端 Smoke Test
 *
 * 使用真实的 ~/.zapmyco/memory/ 目录验证完整生命周期。
 * 运行: pnpm run test -- --run src/__tests__/tools/memory-smoke.test.ts
 */
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryStore } from '@/cli/repl/tools/memory-tool';

const REAL_MEMORY_DIR = join(homedir(), '.zapmyco', 'memory');

describe('Memory Smoke Test (真实目录)', () => {
  const store = new MemoryStore();

  beforeAll(async () => {
    // 清理旧数据，确保干净环境
    await rm(REAL_MEMORY_DIR, { recursive: true, force: true });
    await store.initialize();
  });

  afterAll(async () => {
    await rm(REAL_MEMORY_DIR, { recursive: true, force: true });
  });

  it('1. 初始化：应创建 4 个文件', async () => {
    const fs = await import('node:fs/promises');
    const files = await fs.readdir(REAL_MEMORY_DIR);
    expect(files).toContain('MEMORY.md');
    expect(files).toContain('user.md');
    expect(files).toContain('project.md');
    expect(files).toContain('session.md');
  });

  it('2. 添加：四种类型各添加一条', async () => {
    expect((await store.add('user', '用户喜欢使用中文交流')).ok).toBe(true);
    expect((await store.add('user', '用户是资深 TypeScript 开发者')).ok).toBe(true);
    expect((await store.add('project', 'zapmyco 正在开发 memory 系统')).ok).toBe(true);
    expect((await store.add('session', '上次讨论了 memory 系统设计方案')).ok).toBe(true);
  });

  it('3. 去重：重复添加应被拒绝', async () => {
    const r = await store.add('user', '用户喜欢使用中文交流');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('已存在');
  });

  it('4. 读取：应包含已添加的条目', async () => {
    const content = await store.read('user');
    expect(content).toContain('用户喜欢使用中文交流');
    expect(content).toContain('TypeScript');
  });

  it('5. 快照：冻结后快照包含当前内容', async () => {
    await store.freezeSnapshot();
    const snap = store.getSnapshot('user');
    expect(snap).toContain('用户喜欢使用中文交流');
    expect(snap).toContain('TypeScript');
  });

  it('6. 快照不变性：冻结后写入不影响快照', async () => {
    await store.add('user', '会话中新写入的内容');
    const snapAfter = store.getSnapshot('user');
    expect(snapAfter).not.toContain('会话中新写入的内容');

    // 但文件内容应包含新条目
    const fresh = await store.read('user');
    expect(fresh).toContain('会话中新写入的内容');
  });

  it('7. 删除：应成功删除匹配条目', async () => {
    const r = await store.remove('user', '会话中新写入的内容');
    expect(r.ok).toBe(true);

    const content = await store.read('user');
    expect(content).not.toContain('会话中新写入的内容');
  });

  it('8. 索引：MEMORY.md 应包含所有类型统计', async () => {
    const index = await store.list();
    expect(index).toContain('# Memory Index');
    expect(index).toContain('user.md');
    expect(index).toContain('project.md');
    expect(index).toContain('session.md');
  });

  it('9. 边界：空内容拒绝', async () => {
    const r = await store.add('user', '');
    expect(r.ok).toBe(false);
  });

  it('10. 边界：超长内容拒绝', async () => {
    const r = await store.add('user', 'x'.repeat(2001));
    expect(r.ok).toBe(false);
  });
});
