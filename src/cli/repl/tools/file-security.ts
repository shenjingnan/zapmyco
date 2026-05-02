/**
 * 文件工具共享安全模块
 *
 * 提供路径验证、敏感路径检查、过期检测、diff 生成等共享功能。
 * 参考 Hermes (file_safety.py) 和 Claude Code (permissions/filesystem.ts) 的设计。
 *
 * @module cli/repl/tools/file-security
 */

import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, normalize, resolve } from 'node:path';

// ============ 敏感路径拒绝列表 ============

/**
 * 敏感路径模式列表
 *
 * 拒绝写入这些路径，防止破坏系统安全或泄露凭据。
 * 参考 Hermes file_safety.py 的 WRITE_DENY_LIST。
 */
const SENSITIVE_PATH_PATTERNS = [
  // SSH/GPG 密钥
  /[/\\]\.ssh[/\\]/,
  /[/\\]\.gnupg[/\\]/,
  // Shell 配置
  /[/\\]\.bashrc$/,
  /[/\\]\.zshrc$/,
  /[/\\]\.profile$/,
  // 环境变量/凭据
  /[/\\]\.env$/,
  /[/\\]\.env\.[a-zA-Z0-9_]+$/,
  // 云凭据
  /[/\\]\.aws[/\\]/,
  /[/\\]\.config[/\\]gh[/\\]/,
  /[/\\]\.kube[/\\]/,
  /[/\\]\.docker[/\\]config\.json$/,
  // Git 内部
  /[/\\]\.git[/\\]config$/,
  /[/\\]\.git[/\\]HEAD$/,
  /[/\\]\.git[/\\]index$/,
  /[/\\]\.git[/\\]hooks[/\\]/,
  /[/\\]\.git[/\\]objects[/\\]/,
  /[/\\]\.git[/\\]refs[/\\]/,
  // 系统文件
  /^\/etc\/sudoers/,
  /^\/etc\/passwd/,
  /^\/etc\/shadow/,
  /^\/etc\/hosts$/,
  /^\/etc\/hostname$/,
  /^\/boot[/\\]/,
  /^\/proc[/\\]/,
  /^\/sys[/\\]/,
  /^\/dev[/\\]/,
  // IDE 配置
  /[/\\]\.vscode[/\\]settings\.json$/,
  /[/\\]\.idea[/\\]/,
];

/**
 * 系统目录前缀（不可写入）
 */
const SYSTEM_DIR_PREFIXES = [
  '/etc/',
  '/boot/',
  '/proc/',
  '/sys/',
  '/dev/',
  '/usr/lib/',
  '/usr/share/',
];

// ============ 路径验证 ============

/**
 * 路径验证结果
 */
export interface PathValidationResult {
  valid: boolean;
  resolved: string;
  reason?: string;
}

/**
 * 验证并解析文件路径
 *
 * 1. 解析为绝对路径
 * 2. 检查是否需要拒绝
 * 3. 检查工作区边界
 */
export function validateFilePath(filePath: string, cwd?: string): PathValidationResult {
  if (!filePath || filePath.trim() === '') {
    return { valid: false, resolved: '', reason: '文件路径不能为空' };
  }

  const workdir = cwd ?? process.cwd();
  let resolved: string;

  try {
    resolved = resolve(isAbsolute(filePath) ? filePath : resolve(workdir, filePath));
    resolved = normalize(resolved);
  } catch {
    return { valid: false, resolved: '', reason: `无法解析路径: ${filePath}` };
  }

  // 检查敏感路径
  const sensitiveCheck = checkSensitivePath(resolved);
  if (sensitiveCheck) {
    return { valid: false, resolved, reason: sensitiveCheck };
  }

  // 检查工作区边界
  if (!isPathWithinWorkdir(resolved, workdir)) {
    return {
      valid: false,
      resolved,
      reason: `路径超出工作区范围: ${resolved}。仅允许在工作区 ${workdir} 内写入文件。`,
    };
  }

  return { valid: true, resolved };
}

/**
 * 检查是否为敏感路径
 * 返回拒绝原因字符串，或 null 表示安全
 */
export function checkSensitivePath(resolvedPath: string): string | null {
  const normalized = resolvedPath.replace(/\\/g, '/');

  // 检查敏感路径模式
  for (const pattern of SENSITIVE_PATH_PATTERNS) {
    if (pattern.test(normalized)) {
      return `拒绝写入敏感路径: ${resolvedPath}`;
    }
  }

  // 检查系统目录前缀
  for (const prefix of SYSTEM_DIR_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      return `拒绝写入系统目录: ${resolvedPath}`;
    }
  }

  return null;
}

/**
 * 检查路径是否在工作区范围内
 */
export function isPathWithinWorkdir(resolvedPath: string, workdir: string): boolean {
  const normalizedPath = normalize(resolvedPath).replace(/\\/g, '/');
  const normalizedWorkdir = normalize(resolve(workdir)).replace(/\\/g, '/');

  // 路径必须以工作区开头
  if (!normalizedPath.startsWith(normalizedWorkdir + '/') && normalizedPath !== normalizedWorkdir) {
    return false;
  }

  return true;
}

// ============ 过期检测（软约束） ============

/**
 * 读取状态跟踪器
 *
 * 记录文件读取时间戳，用于写入前检测外部修改。
 * 参考 Claude Code 的 readFileState 和 Hermes 的 stale detection。
 */
class ReadStateTracker {
  private state = new Map<string, { timestamp: number; size: number }>();

  /**
   * 记录文件读取
   */
  recordRead(filePath: string): void {
    try {
      const stat = statSync(filePath);
      this.state.set(filePath, {
        timestamp: stat.mtimeMs,
        size: stat.size,
      });
    } catch {
      // 文件不存在，不记录
    }
  }

  /**
   * 记录文件写入（更新读取时间戳，避免自身写入触发过期警告）
   */
  recordWrite(filePath: string): void {
    try {
      const stat = statSync(filePath);
      this.state.set(filePath, {
        timestamp: stat.mtimeMs,
        size: stat.size,
      });
    } catch {
      this.state.delete(filePath);
    }
  }

  /**
   * 检查文件是否过期（自上次读取后被修改）
   * 返回 null 表示安全，返回警告消息表示可能过期
   */
  checkStale(filePath: string): string | null {
    const lastRead = this.state.get(filePath);
    if (!lastRead) {
      // 未记录读取，无法判断，放过
      return null;
    }

    try {
      const currentStat = statSync(filePath);
      if (currentStat.mtimeMs > lastRead.timestamp + 1000) {
        // 1 秒容差，避免 fs 精度问题
        return `文件自上次读取后已被修改（警告：可能发生外部变更）`;
      }
    } catch {
      // 文件已不存在，放过（write 工具会创建它）
      return null;
    }

    return null;
  }
}

/** 全局单例 */
export const readStateTracker = new ReadStateTracker();

// ============ Diff 生成 ============

/**
 * 生成简单的 unified diff
 *
 * 用于 write/edit 工具返回时展示改动内容。
 */
export function generateSimpleDiff(
  filePath: string,
  oldContent: string | null,
  newContent: string
): string {
  if (oldContent === null) {
    // 新建文件
    const lines = newContent.split('\n');
    return `--- /dev/null\n+++ ${filePath}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}`;
  }

  if (oldContent === newContent) {
    return '(无变化)';
  }

  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // 简单的逐行比较 diff
  const diffLines: string[] = [];
  diffLines.push(`--- ${filePath}`);
  diffLines.push(`+++ ${filePath}`);

  // 找到共同的头部
  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start++;
  }

  // 找到共同的尾部
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  const contextStart = Math.max(0, start - 3);
  const oldHunkLen = oldEnd - contextStart;
  const newHunkLen = newEnd - contextStart;

  diffLines.push(`@@ -${contextStart + 1},${oldHunkLen} +${contextStart + 1},${newHunkLen} @@`);

  for (let i = contextStart; i < oldEnd && i - contextStart < 50; i++) {
    if (i < start || i >= oldEnd) {
      diffLines.push(` ${oldLines[i]}`);
    } else if (i < oldEnd && i < 0) {
      diffLines.push(` ${oldLines[i]}`);
    }
  }

  // 简单追加模式（全量旧 → 全量新）
  const maxContext = 60;
  for (let i = contextStart; i < oldEnd && i - contextStart < maxContext; i++) {
    if (i >= start) {
      diffLines.push(`-${oldLines[i]}`);
    }
  }
  for (let i = contextStart; i < newEnd && i - contextStart < maxContext; i++) {
    if (i >= start) {
      diffLines.push(`+${newLines[i]}`);
    }
  }

  return diffLines.join('\n');
}

// ============ 通用写入函数 ============

/**
 * 写入文件内容
 *
 * 自动创建父目录，使用原子写入（先写临时文件再重命名）。
 */
export function writeFileContent(filePath: string, content: string): void {
  const { mkdirSync, writeFileSync } = require('node:fs');
  const { dirname } = require('node:path');

  // 确保父目录存在
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });

  // 写入文件
  writeFileSync(filePath, content, 'utf-8');
}

/**
 * 读取文件内容（同步）
 * 返回文件内容字符串，或 null 表示文件不存在
 */
export function readFileContent(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}
