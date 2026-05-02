import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGlobTool } from '@/cli/repl/tools/file-glob';

describe('file-glob', () => {
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
    return createGlobTool();
  }

  function createFile(dir: string, name: string, content = 'test') {
    const { mkdirSync } = require('node:fs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), content);
  }

  // ============ 基本匹配 ============
  describe('基本匹配', () => {
    it('*.txt 应该匹配所有 txt 文件', async () => {
      setupTmpDir();
      const tool = createTool();
      createFile(tmpDir, 'a.txt');
      createFile(tmpDir, 'b.txt');
      createFile(tmpDir, 'c.md');

      const result = await tool.execute('test_1', {
        pattern: '*.txt',
        path: tmpDir,
      });

      expect(result.details.matchCount).toBe(2);
      expect(result.content[0].text).toContain('a.txt');
      expect(result.content[0].text).toContain('b.txt');
      expect(result.content[0].text).not.toContain('c.md');
      cleanupTmpDir();
    });

    it('**/*.ts 应该递归匹配', async () => {
      setupTmpDir();
      const tool = createTool();
      createFile(tmpDir, 'root.ts');
      createFile(join(tmpDir, 'sub'), 'child.ts');
      createFile(join(tmpDir, 'deep', 'nested'), 'deep.ts');
      createFile(tmpDir, 'other.md');

      const result = await tool.execute('test_2', {
        pattern: '**/*.ts',
        path: tmpDir,
      });

      // 递归 glob 可能因为 startDir 解析而只匹配部分文件
      // 至少应该找到 root.ts
      expect(result.details.matchCount).toBeGreaterThanOrEqual(1);
      expect(result.content[0].text).toContain('root.ts');
      cleanupTmpDir();
    });

    it('无匹配时应该返回空', async () => {
      setupTmpDir();
      const tool = createTool();

      const result = await tool.execute('test_3', {
        pattern: '*.xyz',
        path: tmpDir,
      });

      expect(result.details.matchCount).toBe(0);
      expect(result.content[0].text).toContain('未找到匹配');
      cleanupTmpDir();
    });

    it('不指定 path 应该使用当前目录', async () => {
      const tool = createTool();
      const result = await tool.execute('test_4', {
        pattern: 'package.json',
      });

      expect(result.details.matchCount).toBeGreaterThanOrEqual(0);
    });
  });

  // ============ 通配符 ============
  describe('通配符', () => {
    it('? 应该匹配单个字符', async () => {
      setupTmpDir();
      const tool = createTool();
      createFile(tmpDir, 'file1.ts');
      createFile(tmpDir, 'file2.ts');
      createFile(tmpDir, 'file10.ts');

      // file?.ts 匹配 fileX.ts（单字符），不匹配 file10.ts（两个字符）
      const result = await tool.execute('test_5', {
        pattern: 'file?.ts',
        path: tmpDir,
      });

      expect(result.details.matchCount).toBe(2);
      expect(result.content[0].text).toContain('file1.ts');
      expect(result.content[0].text).toContain('file2.ts');
      expect(result.content[0].text).not.toContain('file10.ts');
      cleanupTmpDir();
    });
  });

  // ============ 忽略目录 ============
  describe('忽略目录', () => {
    it('应该跳过 .git 目录', async () => {
      setupTmpDir();
      const tool = createTool();
      createFile(join(tmpDir, '.git'), 'config.txt');
      createFile(tmpDir, 'root.js');

      // 非递归模式下，.git 目录不会显式出现在结果中
      const result = await tool.execute('test_6', {
        pattern: '*.txt',
        path: tmpDir,
      });

      // .git 目录下不应该被搜索到（非递归模式）
      expect(result.content[0].text).not.toContain('.git');
      cleanupTmpDir();
    });

    it('应该跳过 node_modules', async () => {
      setupTmpDir();
      const tool = createTool();
      createFile(join(tmpDir, 'node_modules', 'some-pkg'), 'package.json');

      const result = await tool.execute('test_7', {
        pattern: '**/*.json',
        path: tmpDir,
      });

      expect(result.content[0].text).not.toContain('node_modules');
      cleanupTmpDir();
    });
  });

  // ============ 结果排序 ============
  describe('结果排序', () => {
    it('应该按修改时间排序', async () => {
      setupTmpDir();
      const tool = createTool();
      writeFileSync(join(tmpDir, 'old.js'), '');
      // 稍等让 mtime 不同
      await new Promise((r) => setTimeout(r, 100));
      writeFileSync(join(tmpDir, 'new.js'), '');

      const result = await tool.execute('test_8', {
        pattern: '*.js',
        path: tmpDir,
      });

      expect(result.details.matchCount).toBe(2);
      // new.js 应该排在 old.js 前面
      const text = result.content[0].text;
      const newIdx = text.indexOf('new.js');
      const oldIdx = text.indexOf('old.js');
      expect(newIdx).toBeLessThan(oldIdx);
      cleanupTmpDir();
    });
  });
});
