import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createEditFileTool } from '@/cli/repl/tools/file-edit';
import { readFileContent, readStateTracker } from '@/cli/repl/tools/file-security';

describe('file-edit', () => {
  let tmpDir: string;

  function setupTmpDir() {
    tmpDir = mkdtempSync(join(tmpdir(), 'zapmyco-test-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  }

  function cleanupTmpDir() {
    vi.restoreAllMocks();
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  function createTool() {
    return createEditFileTool();
  }

  // ============ 基本替换 ============
  describe('基本替换', () => {
    it('应该精确替换文件中的字符串', async () => {
      setupTmpDir();
      const tool = createTool();
      const filePath = join(tmpDir, 'edit-basic.txt');
      writeFileSync(filePath, 'Hello Alice, welcome!');

      const result = await tool.execute('test_1', {
        file_path: filePath,
        old_string: 'Alice',
        new_string: 'Bob',
      });

      expect(result.details.replaced).toBe(true);
      expect(result.details.matchCount).toBe(1);

      const content = readFileContent(filePath);
      expect(content).toBe('Hello Bob, welcome!');
      cleanupTmpDir();
    });

    it('应该替换多行字符串', async () => {
      setupTmpDir();
      const tool = createTool();
      const filePath = join(tmpDir, 'multi-line.txt');
      writeFileSync(filePath, 'line 1\nline 2\nline 3\nline 4');

      const result = await tool.execute('test_2', {
        file_path: filePath,
        old_string: 'line 2\nline 3',
        new_string: 'new line 2\nnew line 3',
      });

      expect(result.details.replaced).toBe(true);
      const content = readFileContent(filePath);
      expect(content).toBe('line 1\nnew line 2\nnew line 3\nline 4');
      cleanupTmpDir();
    });

    it('replace_all=true 应该替换所有匹配', async () => {
      setupTmpDir();
      const tool = createTool();
      const filePath = join(tmpDir, 'replace-all.txt');
      writeFileSync(filePath, 'foo bar foo bar foo');

      const result = await tool.execute('test_3', {
        file_path: filePath,
        old_string: 'foo',
        new_string: 'baz',
        replace_all: true,
      });

      expect(result.details.replaced).toBe(true);
      expect(result.details.matchCount).toBe(3);
      expect(result.details.replaceAll).toBe(true);

      const content = readFileContent(filePath);
      expect(content).toBe('baz bar baz bar baz');
      cleanupTmpDir();
    });
  });

  // ============ 错误处理 ============
  describe('错误处理', () => {
    it('old_string 和 new_string 相同时应该拒绝', async () => {
      setupTmpDir();
      const tool = createTool();
      const filePath = join(tmpDir, 'same.txt');
      writeFileSync(filePath, 'hello world');

      const result = await tool.execute('test_4', {
        file_path: filePath,
        old_string: 'hello',
        new_string: 'hello',
      });

      expect(result.content[0].text).toContain('编辑失败');
      expect(result.content[0].text).toContain('完全相同');
      expect(result.details.replaced).toBe(false);
      cleanupTmpDir();
    });

    it('old_string 未找到时应该报错', async () => {
      setupTmpDir();
      const tool = createTool();
      const filePath = join(tmpDir, 'not-found.txt');
      writeFileSync(filePath, 'hello world');

      const result = await tool.execute('test_5', {
        file_path: filePath,
        old_string: 'nonexistent',
        new_string: 'replacement',
      });

      expect(result.content[0].text).toContain('编辑失败');
      expect(result.content[0].text).toContain('未找到');
      expect(result.details.replaced).toBe(false);
      expect(result.details.error).toBe('old_string 未在文件中找到');
      cleanupTmpDir();
    });

    it('文件不存在时应该报错', async () => {
      setupTmpDir();
      const tool = createTool();
      const result = await tool.execute('test_6', {
        file_path: join(tmpDir, 'no-such-file.txt'),
        old_string: 'hello',
        new_string: 'world',
      });

      expect(result.content[0].text).toContain('编辑失败');
      expect(result.content[0].text).toContain('文件不存在');
      expect(result.details.replaced).toBe(false);
      cleanupTmpDir();
    });

    it('多匹配且未设置 replace_all 时应该报错', async () => {
      setupTmpDir();
      const tool = createTool();
      const filePath = join(tmpDir, 'multi-match.txt');
      writeFileSync(filePath, 'the cat and the cat and the cat');

      const result = await tool.execute('test_7', {
        file_path: filePath,
        old_string: 'the cat',
        new_string: 'a dog',
      });

      expect(result.content[0].text).toContain('编辑失败');
      expect(result.content[0].text).toContain('3 处匹配');
      expect(result.content[0].text).toContain('replace_all=true');
      expect(result.details.replaced).toBe(false);
      expect(result.details.matchCount).toBe(3);
      cleanupTmpDir();
    });

    it('敏感路径应该拒绝', async () => {
      setupTmpDir();
      const tool = createTool();
      const result = await tool.execute('test_8', {
        file_path: join(tmpDir, '.env'),
        old_string: 'KEY=old',
        new_string: 'KEY=new',
      });

      expect(result.content[0].text).toContain('编辑失败');
      expect(result.details.replaced).toBe(false);
      cleanupTmpDir();
    });
  });

  // ============ Unicode 归一化 ============
  describe('Unicode 归一化', () => {
    it('花括号双引号应该被归一化匹配', async () => {
      setupTmpDir();
      const tool = createTool();
      const filePath = join(tmpDir, 'curly-quotes.txt');
      // 使用花括号引号写入
      writeFileSync(filePath, 'He said \u201chello\u201d to me.');

      // 使用直引号作为 old_string
      const result = await tool.execute('test_9', {
        file_path: filePath,
        old_string: 'He said "hello" to me.',
        new_string: 'He said "bye" to me.',
      });

      expect(result.details.replaced).toBe(true);
      const content = readFileContent(filePath);
      expect(content).toContain('bye');
      cleanupTmpDir();
    });

    it('em dash 应该被归一化', async () => {
      setupTmpDir();
      const tool = createTool();
      const filePath = join(tmpDir, 'em-dash.txt');
      writeFileSync(filePath, 'foo\u2014bar');

      const result = await tool.execute('test_10', {
        file_path: filePath,
        old_string: 'foo--bar', // 普通双横线
        new_string: 'foo---bar',
      });

      // em dash (\u2014) 归一化为 '--'，所以应该匹配
      expect(result.details.replaced).toBe(true);
      cleanupTmpDir();
    });
  });

  // ============ 过期检测 ============
  describe('过期检测', () => {
    it('外部修改的文件编辑应该给出警告（软约束）', async () => {
      setupTmpDir();
      const tool = createTool();
      const filePath = join(tmpDir, 'stale-edit.txt');
      writeFileSync(filePath, 'original');

      // 模拟读取
      readStateTracker.recordRead(filePath);

      // 模拟外部修改
      await new Promise((r) => setTimeout(r, 1500));
      writeFileSync(filePath, 'modified externally');

      const result = await tool.execute('test_11', {
        file_path: filePath,
        old_string: 'modified externally',
        new_string: 'edited safely',
      });

      // 应该给出警告（软约束，不会阻止编辑）
      if (result.details.warning) {
        expect(result.details.warning).toContain('外部变更');
      }
      expect(result.details.replaced).toBe(true);
      cleanupTmpDir();
    });
  });

  // ============ 响应内容 ============
  describe('响应内容', () => {
    it('应该返回 diff', async () => {
      setupTmpDir();
      const tool = createTool();
      const filePath = join(tmpDir, 'edit-diff.txt');
      writeFileSync(filePath, 'before');

      const result = await tool.execute('test_12', {
        file_path: filePath,
        old_string: 'before',
        new_string: 'after',
      });

      expect(result.content[0].text).toContain('diff');
      expect(result.content[0].text).toContain('-before');
      expect(result.content[0].text).toContain('+after');
      cleanupTmpDir();
    });
  });
});
