import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGrepTool } from '@/cli/repl/tools/file-grep';

describe('file-grep', () => {
  let tmpDir: string;

  function setupTmpDir() {
    tmpDir = mkdtempSync(join(tmpdir(), 'zapmyco-test-'));
  }

  function cleanupTmpDir() {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  function createTool() {
    return createGrepTool();
  }

  function createFile(dir: string, name: string, content = 'test') {
    const { mkdirSync } = require('node:fs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), content);
  }

  // ============ content 模式 ============
  describe('content 模式', () => {
    it('应该找到匹配行', async () => {
      setupTmpDir();
      const tool = createTool();
      createFile(tmpDir, 'a.ts', 'import foo from "bar";\nconst x = 1;\nexport default foo;');

      const result = await tool.execute('test_1', {
        pattern: 'import',
        path: tmpDir,
      });

      expect(result.details.matchCount).toBe(1);
      expect(result.content[0].text).toContain('import foo');
      cleanupTmpDir();
    });

    it('应该支持正则表达式', async () => {
      setupTmpDir();
      const tool = createTool();
      createFile(tmpDir, 'b.ts', 'function fn1() {}\nfunction fn2() {}\nconst x = 1;');

      const result = await tool.execute('test_2', {
        pattern: 'function\\s+\\w+',
        path: tmpDir,
      });

      expect(result.details.matchCount).toBe(2);
      expect(result.content[0].text).toContain('fn1');
      expect(result.content[0].text).toContain('fn2');
      cleanupTmpDir();
    });

    it('无匹配时应该返回空', async () => {
      setupTmpDir();
      const tool = createTool();
      createFile(tmpDir, 'c.ts', 'hello world');

      const result = await tool.execute('test_3', {
        pattern: 'nonexistent_pattern_xyz',
        path: tmpDir,
      });

      expect(result.details.matchCount).toBe(0);
      expect(result.content[0].text).toContain('未找到匹配');
      cleanupTmpDir();
    });

    it('无效正则应该报错', async () => {
      setupTmpDir();
      const tool = createTool();

      const result = await tool.execute('test_4', {
        pattern: '[invalid(regex',
        path: tmpDir,
      });

      cleanupTmpDir();

      expect(result.content[0].text).toContain('无效的正则表达式');
    });
  });

  // ============ files_with_matches 模式 ============
  describe('files_with_matches 模式', () => {
    it('应该返回匹配文件列表', async () => {
      setupTmpDir();
      const tool = createTool();
      createFile(tmpDir, 'foo.ts', 'import x');
      createFile(tmpDir, 'bar.ts', 'const y = 1;');
      createFile(tmpDir, 'baz.ts', 'import z');

      const result = await tool.execute('test_5', {
        pattern: 'import',
        path: tmpDir,
        output_mode: 'files_with_matches',
      });

      expect(result.details.outputMode).toBe('files_with_matches');
      expect(result.details.fileCount).toBe(2);
      expect(result.content[0].text).toContain('foo.ts');
      expect(result.content[0].text).toContain('baz.ts');
      expect(result.content[0].text).not.toContain('bar.ts');
      cleanupTmpDir();
    });

    it('无匹配应该返回空', async () => {
      setupTmpDir();
      const tool = createTool();
      createFile(tmpDir, 'd.ts', 'hello');

      const result = await tool.execute('test_6', {
        pattern: 'zzz_no_match',
        path: tmpDir,
        output_mode: 'files_with_matches',
      });

      expect(result.details.fileCount).toBe(0);
      expect(result.content[0].text).toContain('未找到匹配');
      cleanupTmpDir();
    });
  });

  // ============ count 模式 ============
  describe('count 模式', () => {
    it('应该返回每个文件的匹配计数', async () => {
      setupTmpDir();
      const tool = createTool();
      createFile(tmpDir, 'many.ts', 'todo: fix this\ntodo: fix that\ndone');

      const result = await tool.execute('test_7', {
        pattern: 'todo',
        path: tmpDir,
        output_mode: 'count',
      });

      expect(result.details.outputMode).toBe('count');
      expect(result.details.matchCount).toBe(2);
      expect(result.content[0].text).toContain('2');
      expect(result.content[0].text).toContain('many.ts');
      cleanupTmpDir();
    });
  });

  // ============ 忽略大小写 ============
  describe('忽略大小写', () => {
    it('-i 应该忽略大小写', async () => {
      setupTmpDir();
      const tool = createTool();
      createFile(tmpDir, 'case.ts', 'Hello World\nHELLO WORLD');

      const result = await tool.execute('test_8', {
        pattern: 'hello',
        path: tmpDir,
        '-i': true,
      });

      expect(result.details.matchCount).toBe(2);
      cleanupTmpDir();
    });

    it('默认大小写敏感', async () => {
      setupTmpDir();
      const tool = createTool();
      createFile(tmpDir, 'sensitive.ts', 'Hello\nHELLO');

      const result = await tool.execute('test_9', {
        pattern: 'Hello',
        path: tmpDir,
      });

      expect(result.details.matchCount).toBe(1);
      cleanupTmpDir();
    });
  });

  // ============ glob 过滤 ============
  describe('glob 过滤', () => {
    it('glob 应该只搜索匹配的文件类型', async () => {
      setupTmpDir();
      const tool = createTool();
      createFile(tmpDir, 'code.ts', 'import x from "y"');
      createFile(tmpDir, 'doc.md', 'import x from "y"');

      const result = await tool.execute('test_10', {
        pattern: 'import',
        path: tmpDir,
        glob: '*.ts',
      });

      expect(result.details.fileCount).toBe(1);
      expect(result.content[0].text).toContain('code.ts');
      expect(result.content[0].text).not.toContain('doc.md');
      cleanupTmpDir();
    });
  });

  // ============ 上下文行 ============
  describe('上下文行', () => {
    it('context 应该显示前后行', async () => {
      setupTmpDir();
      const tool = createTool();
      createFile(tmpDir, 'ctx.ts', 'line 1\nline 2\nline 3 target line\nline 4\nline 5');

      const result = await tool.execute('test_11', {
        pattern: 'target',
        path: tmpDir,
        context: 1,
      });

      expect(result.details.matchCount).toBe(1);
      expect(result.content[0].text).toContain('line 2');
      expect(result.content[0].text).toContain('target');
      expect(result.content[0].text).toContain('line 4');
      cleanupTmpDir();
    });

    it('二进制文件扩展名不应该被搜索', async () => {
      setupTmpDir();
      const tool = createTool();
      createFile(tmpDir, 'image.png', 'this is actually text but has png extension');

      const result = await tool.execute('test_12', {
        pattern: 'text',
        path: tmpDir,
      });

      // .png 文件应该被跳过
      expect(result.content[0].text).not.toContain('image.png');
      cleanupTmpDir();
    });
  });
});
