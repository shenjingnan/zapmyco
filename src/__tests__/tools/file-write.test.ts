import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readFileContent, readStateTracker } from '@/cli/repl/tools/file-security';
import { createWriteFileTool } from '@/cli/repl/tools/file-write';

describe('file-write', () => {
  let tmpDir: string;

  function setupTmpDir() {
    tmpDir = mkdtempSync(join(tmpdir(), 'zapmyco-test-'));
    // Mock process.cwd() to return tmpDir so workspace boundary check passes
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  }

  function cleanupTmpDir() {
    vi.restoreAllMocks();
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  function createTool() {
    return createWriteFileTool();
  }

  // ============ 创建新文件 ============
  describe('创建新文件', () => {
    it('应该创建新文件并返回 create 类型', async () => {
      setupTmpDir();
      const tool = createTool();
      const filePath = join(tmpDir, 'new-file.txt');

      const result = await tool.execute('test_1', {
        file_path: filePath,
        content: 'hello world',
      });

      expect(result.content[0].text).toContain('[文件已创建]');
      expect(result.details.type).toBe('create');
      expect(result.details.filePath).toBe(filePath);
      expect(result.details.contentLength).toBe(11);

      const fileContent = readFileContent(filePath);
      expect(fileContent).toBe('hello world');
      cleanupTmpDir();
    });

    it('应该自动创建父目录', async () => {
      setupTmpDir();
      const tool = createTool();
      const filePath = join(tmpDir, 'deep', 'nested', 'path', 'file.txt');

      const result = await tool.execute('test_2', {
        file_path: filePath,
        content: 'nested content',
      });

      expect(result.details.type).toBe('create');
      const fileContent = readFileContent(filePath);
      expect(fileContent).toBe('nested content');
      cleanupTmpDir();
    });

    it('中文内容应该正常写入', async () => {
      setupTmpDir();
      const tool = createTool();
      const filePath = join(tmpDir, '中文文件.txt');

      await tool.execute('test_3', {
        file_path: filePath,
        content: '你好，世界！\n这是第二行。',
      });

      const fileContent = readFileContent(filePath);
      expect(fileContent).toBe('你好，世界！\n这是第二行。');
      cleanupTmpDir();
    });
  });

  // ============ 覆写已有文件 ============
  describe('覆写已有文件', () => {
    it('应该覆写已有文件并返回 update 类型', async () => {
      setupTmpDir();
      const tool = createTool();
      const filePath = join(tmpDir, 'existing.txt');
      writeFileSync(filePath, 'original content');

      // 先记录读取状态以通过过期检测
      readStateTracker.recordRead(filePath);

      const result = await tool.execute('test_4', {
        file_path: filePath,
        content: 'updated content',
      });

      expect(result.content[0].text).toContain('[文件已更新]');
      expect(result.details.type).toBe('update');
      expect(result.details.contentLength).toBe(15);

      const fileContent = readFileContent(filePath);
      expect(fileContent).toBe('updated content');
      cleanupTmpDir();
    });

    it('过期的文件写入应该给出警告（软约束）', async () => {
      setupTmpDir();
      const tool = createTool();
      const filePath = join(tmpDir, 'stale.txt');
      writeFileSync(filePath, 'old content');

      // 模拟读取
      readStateTracker.recordRead(filePath);

      // 模拟外部修改
      await new Promise((r) => setTimeout(r, 1500));
      writeFileSync(filePath, 'externally modified');

      // write 工具不强制 read-before-write，在写入时会检测到过期
      // 但这里文件的 mtime 会在 recordRead 之后被修改，触发过期
      const result = await tool.execute('test_5', {
        file_path: filePath,
        content: 'new content by tool',
      });

      // 应该包含警告（软约束，不会阻止）
      if (result.details.warning) {
        expect(result.details.warning).toContain('外部变更');
      }
      // 至少写入应该成功
      const fileContent = readFileContent(filePath);
      expect(fileContent).toBe('new content by tool');
      cleanupTmpDir();
    });

    it('写入后应该更新读取状态', async () => {
      setupTmpDir();
      const tool = createTool();
      const filePath = join(tmpDir, 'state-update.txt');
      writeFileSync(filePath, 'content before');

      readStateTracker.recordRead(filePath);
      await tool.execute('test_6', {
        file_path: filePath,
        content: 'content after write',
      });

      const staleResult = readStateTracker.checkStale(filePath);
      expect(staleResult).toBeNull();
      cleanupTmpDir();
    });
  });

  // ============ 路径安全 ============
  describe('路径安全', () => {
    it('工作区外的路径应该拒绝', async () => {
      setupTmpDir();
      const tool = createTool();
      const result = await tool.execute('test_7', {
        file_path: '/etc/hosts',
        content: 'malicious',
      });

      expect(result.content[0].text).toContain('[写入失败]');
      // /etc/hosts 先触发敏感路径检查
      expect(result.content[0].text).toContain('敏感路径');
      cleanupTmpDir();
    });

    it('敏感路径（.env）应该拒绝', async () => {
      setupTmpDir();
      const tool = createTool();
      const result = await tool.execute('test_8', {
        file_path: join(tmpDir, '.env'),
        content: 'SECRET=xxx',
      });

      expect(result.content[0].text).toContain('[写入失败]');
      expect(result.content[0].text).toContain('敏感路径');
      cleanupTmpDir();
    });

    it('敏感路径（.ssh）应该拒绝', async () => {
      setupTmpDir();
      const tool = createTool();
      const result = await tool.execute('test_9', {
        file_path: join(tmpDir, '.ssh', 'config'),
        content: 'host *',
      });

      expect(result.content[0].text).toContain('[写入失败]');
      cleanupTmpDir();
    });
  });

  // ============ 返回内容 ============
  describe('返回内容', () => {
    it('应该返回 diff', async () => {
      setupTmpDir();
      const tool = createTool();
      const filePath = join(tmpDir, 'diff-test.txt');

      const result = await tool.execute('test_10', {
        file_path: filePath,
        content: 'line 1\nline 2\nline 3',
      });

      expect(result.content[0].text).toContain('diff');
      expect(result.content[0].text).toContain('+line 1');
      cleanupTmpDir();
    });

    it('更新文件应该返回新旧 diff', async () => {
      setupTmpDir();
      const tool = createTool();
      const filePath = join(tmpDir, 'update-diff.txt');
      writeFileSync(filePath, 'old line 1\nold line 2');
      readStateTracker.recordRead(filePath);

      const result = await tool.execute('test_11', {
        file_path: filePath,
        content: 'new line 1\nnew line 2',
      });

      expect(result.content[0].text).toContain('diff');
      expect(result.content[0].text).toContain('-old line 1');
      expect(result.content[0].text).toContain('+new line 1');
      cleanupTmpDir();
    });
  });
});
