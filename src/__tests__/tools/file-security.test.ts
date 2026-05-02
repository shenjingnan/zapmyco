import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkSensitivePath,
  generateSimpleDiff,
  isPathWithinWorkdir,
  readFileContent,
  readStateTracker,
  validateFilePath,
  writeFileContent,
} from '@/cli/repl/tools/file-security';

describe('file-security', () => {
  let tmpDir: string;

  function setupTmpDir() {
    tmpDir = mkdtempSync(join(tmpdir(), 'zapmyco-test-'));
  }

  function cleanupTmpDir() {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // ============ validateFilePath ============
  describe('validateFilePath', () => {
    it('空路径应该拒绝', () => {
      const result = validateFilePath('');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('文件路径不能为空');
    });

    it('空白路径应该拒绝', () => {
      const result = validateFilePath('   ');
      expect(result.valid).toBe(false);
    });

    it('绝对路径在工作区内应该通过', () => {
      setupTmpDir();
      const filePath = join(tmpDir, 'test.txt');
      const result = validateFilePath(filePath, tmpDir);
      expect(result.valid).toBe(true);
      expect(result.resolved).toBe(resolve(filePath));
      cleanupTmpDir();
    });

    it('相对路径应该解析并验证', () => {
      setupTmpDir();
      const result = validateFilePath('test.txt', tmpDir);
      expect(result.valid).toBe(true);
      expect(result.resolved).toBe(join(tmpDir, 'test.txt'));
      cleanupTmpDir();
    });

    it('工作区外的绝对路径应该拒绝', () => {
      setupTmpDir();
      const result = validateFilePath('/etc/passwd', tmpDir);
      expect(result.valid).toBe(false);
      // checkSensitivePath 在 isPathWithinWorkdir 之前检查，所以先触发敏感路径拦截
      expect(result.reason).toContain('敏感路径');
      cleanupTmpDir();
    });

    it('以 .. 尝试逃逸工作区应该拒绝', () => {
      setupTmpDir();
      const result = validateFilePath(join(tmpDir, '..', 'outside.txt'), tmpDir);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('超出工作区范围');
      cleanupTmpDir();
    });

    it('敏感路径（.ssh 目录）应该拒绝', () => {
      setupTmpDir();
      const result = validateFilePath('/home/user/.ssh/id_rsa');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('敏感路径');
      cleanupTmpDir();
    });

    it('敏感路径（.env 文件）应该拒绝', () => {
      const result = validateFilePath('/home/user/project/.env');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('敏感路径');
    });

    it('系统目录 /etc/ 应该拒绝', () => {
      const result = validateFilePath('/etc/sudoers');
      expect(result.valid).toBe(false);
      // /etc/sudoers 同时被 SENSITIVE_PATH_PATTERNS 和 SYSTEM_DIR_PREFIXES 匹配
      // SENSITIVE_PATH_PATTERNS 先检查，返回"敏感路径"
      expect(result.reason).toContain('敏感路径');
    });
  });

  // ============ checkSensitivePath ============
  describe('checkSensitivePath', () => {
    it('普通文件路径应该返回 null', () => {
      expect(checkSensitivePath('/home/user/project/src/index.ts')).toBeNull();
    });

    it('.ssh 路径应该拒绝', () => {
      const result = checkSensitivePath('/home/user/.ssh/id_rsa');
      expect(result).toContain('敏感路径');
    });

    it('.env 文件应该拒绝', () => {
      const result = checkSensitivePath('/home/user/project/.env');
      expect(result).toContain('敏感路径');
    });

    it('.env.local 应该拒绝', () => {
      const result = checkSensitivePath('/home/user/project/.env.local');
      expect(result).toContain('敏感路径');
    });

    it('.aws 目录应该拒绝', () => {
      const result = checkSensitivePath('/home/user/.aws/credentials');
      expect(result).toContain('敏感路径');
    });

    it('.bashrc 应该拒绝', () => {
      const result = checkSensitivePath('/home/user/.bashrc');
      expect(result).toContain('敏感路径');
    });

    it('/etc/sudoers 应该拒绝', () => {
      const result = checkSensitivePath('/etc/sudoers');
      expect(result).toContain('敏感路径');
    });

    it('/boot/vmlinuz 应该被拒绝', () => {
      const result = checkSensitivePath('/boot/vmlinuz');
      // /boot/ 同时匹配 pattern 和 system dir prefix
      expect(result).not.toBeNull();
    });

    it('/proc/cpuinfo 应该被拒绝', () => {
      const result = checkSensitivePath('/proc/cpuinfo');
      expect(result).not.toBeNull();
    });

    it('.git/config 应该拒绝', () => {
      const result = checkSensitivePath('/project/.git/config');
      expect(result).toContain('敏感路径');
    });

    it('.gnupg 目录应该拒绝', () => {
      const result = checkSensitivePath('/home/user/.gnupg/secret');
      expect(result).toContain('敏感路径');
    });

    it('.kube 目录应该拒绝', () => {
      const result = checkSensitivePath('/home/user/.kube/config');
      expect(result).toContain('敏感路径');
    });
  });

  // ============ isPathWithinWorkdir ============
  describe('isPathWithinWorkdir', () => {
    it('工作区内的文件应该返回 true', () => {
      expect(isPathWithinWorkdir('/project/src/index.ts', '/project')).toBe(true);
    });

    it('工作区外的文件应该返回 false', () => {
      expect(isPathWithinWorkdir('/other/file.ts', '/project')).toBe(false);
    });

    it('工作区根目录本身应该返回 true', () => {
      expect(isPathWithinWorkdir('/project', '/project')).toBe(true);
    });

    it('子目录应该返回 true', () => {
      expect(isPathWithinWorkdir('/project/src/deep/nested/file.ts', '/project')).toBe(true);
    });

    it('相似前缀但不属于工作区应该返回 false', () => {
      expect(isPathWithinWorkdir('/project-other/file.ts', '/project')).toBe(false);
    });
  });

  // ============ ReadStateTracker ============
  describe('ReadStateTracker', () => {
    it('未记录读取的返回 null', () => {
      setupTmpDir();
      const filePath = join(tmpDir, 'new-file.txt');
      writeFileSync(filePath, 'hello');
      const result = readStateTracker.checkStale(filePath);
      expect(result).toBeNull();
      cleanupTmpDir();
    });

    it('记录读取后应该不认为是过期', () => {
      setupTmpDir();
      const filePath = join(tmpDir, 'tracked.txt');
      writeFileSync(filePath, 'hello');
      readStateTracker.recordRead(filePath);
      const result = readStateTracker.checkStale(filePath);
      expect(result).toBeNull();
      cleanupTmpDir();
    });

    it('记录写入后应该不触发过期', () => {
      setupTmpDir();
      const filePath = join(tmpDir, 'write-tracked.txt');
      writeFileSync(filePath, 'hello');
      readStateTracker.recordRead(filePath);
      writeFileSync(filePath, 'updated after write');
      readStateTracker.recordWrite(filePath);
      const result = readStateTracker.checkStale(filePath);
      expect(result).toBeNull();
      cleanupTmpDir();
    });

    it('不存在的文件 recordRead 不报错', () => {
      setupTmpDir();
      const filePath = join(tmpDir, 'nonexistent.txt');
      expect(() => readStateTracker.recordRead(filePath)).not.toThrow();
      cleanupTmpDir();
    });

    it('不存在的文件 recordWrite 安全处理', () => {
      setupTmpDir();
      const filePath = join(tmpDir, 'nonexistent-write.txt');
      expect(() => readStateTracker.recordWrite(filePath)).not.toThrow();
      cleanupTmpDir();
    });
  });

  // ============ generateSimpleDiff ============
  describe('generateSimpleDiff', () => {
    it('新建文件应该生成创建 diff', () => {
      const diff = generateSimpleDiff('/test/new.txt', null, 'hello\nworld');
      expect(diff).toContain('--- /dev/null');
      expect(diff).toContain('+++ /test/new.txt');
      expect(diff).toContain('+hello');
      expect(diff).toContain('+world');
    });

    it('无变化时应该返回提示', () => {
      const diff = generateSimpleDiff('/test/file.txt', 'same', 'same');
      expect(diff).toBe('(无变化)');
    });

    it('修改文件应该生成 diff', () => {
      const diff = generateSimpleDiff('/test/file.ts', 'old line', 'new line');
      expect(diff).toContain('--- /test/file.ts');
      expect(diff).toContain('+++ /test/file.ts');
      expect(diff).toContain('-old line');
      expect(diff).toContain('+new line');
    });

    it('大文件 diff 应该正常生成', () => {
      const oldLines = Array.from({ length: 100 }, (_, i) => `line${i}`).join('\n');
      const newLines = Array.from({ length: 100 }, (_, i) => `new${i}`).join('\n');
      const diff = generateSimpleDiff('/test/big.ts', oldLines, newLines);
      expect(diff).toContain('---');
      expect(diff).toContain('+++');
      expect(diff.length).toBeGreaterThan(0);
    });
  });

  // ============ readFileContent / writeFileContent ============
  describe('readFileContent & writeFileContent', () => {
    it('不存在的文件应该返回 null', () => {
      setupTmpDir();
      const result = readFileContent(join(tmpDir, 'no-exist.txt'));
      expect(result).toBeNull();
      cleanupTmpDir();
    });

    it('应该能读取刚写入的文件', () => {
      setupTmpDir();
      const filePath = join(tmpDir, 'rw-test.txt');
      writeFileContent(filePath, 'hello world');
      const result = readFileContent(filePath);
      expect(result).toBe('hello world');
      cleanupTmpDir();
    });

    it('应该自动创建父目录', () => {
      setupTmpDir();
      const filePath = join(tmpDir, 'deep', 'nested', 'dirs', 'file.txt');
      writeFileContent(filePath, 'deep content');
      const result = readFileContent(filePath);
      expect(result).toBe('deep content');
      cleanupTmpDir();
    });

    it('覆写文件应该生效', () => {
      setupTmpDir();
      const filePath = join(tmpDir, 'overwrite.txt');
      writeFileContent(filePath, 'first');
      writeFileContent(filePath, 'second');
      const result = readFileContent(filePath);
      expect(result).toBe('second');
      cleanupTmpDir();
    });

    it('中文内容应该能正常读写', () => {
      setupTmpDir();
      const filePath = join(tmpDir, 'chinese.txt');
      writeFileContent(filePath, '你好世界\nこんにちは');
      const result = readFileContent(filePath);
      expect(result).toBe('你好世界\nこんにちは');
      cleanupTmpDir();
    });
  });
});
