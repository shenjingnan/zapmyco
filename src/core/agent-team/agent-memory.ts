/**
 * Agent 类型记忆系统
 *
 * 按 Agent 类型隔离的持久化记忆，允许 Agent 在执行过程中积累经验
 * 并在后续执行中引用。
 *
 * 存储位置: ~/.zapmyco/memory/agents/<typeId>.md
 *
 * 设计要点:
 * - **类型隔离**: 每种 Agent 类型独立记忆文件
 * - **快照模式**: 会话开始时冻结内容到快照，会话中写入不影响当前执行
 * - **原子写入**: 先写临时文件，再 rename（防部分写入）
 * - **条目分隔**: 使用 §（Section Sign）
 * - **追加模式**: 支持向指定类型追加记忆条目
 *
 * 与系统级 Memory 的区别：
 * - 系统 Memory（user/project/session）: 面向用户和项目，全局共享
 * - Agent Memory（per-type）: 面向特定 Agent 类型，帮助该类型持续改进
 *
 * @module core/agent-team
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { logger } from '@/infra/logger';

const log = logger.child('agent-memory');

// ============ 常量 ============

/** 记忆根目录 */
const AGENT_MEMORY_DIR = join(homedir(), '.zapmyco', 'memory', 'agents');

/** 条目分隔符 */
const SECTION_DELIMITER = '\n§ ';

/** 单条记忆最大长度（字符） */
const MAX_ENTRY_LENGTH = 2000;

/** 单个文件最大条目数 */
const MAX_ENTRIES = 50;

/** 快照内容（会话级别缓存） */
const snapshotCache: Map<string, string> = new Map();

/** Promise 锁，防止并发初始化 */
let initPromise: Promise<void> | null = null;

// ============ 公共 API ============

/**
 * 确保记忆目录存在
 */
export async function initAgentMemory(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await mkdir(AGENT_MEMORY_DIR, { recursive: true });
    log.debug('Agent 记忆目录已就绪', { dir: AGENT_MEMORY_DIR });
  })();
  return initPromise;
}

/**
 * 冻结快照：读取所有 Agent 类型的记忆内容并缓存
 *
 * 在会话开始时调用一次，后续读取 memorySnapshot 都返回冻结内容。
 * 会话中写入操作只更新磁盘，不影响当前快照。
 */
export async function freezeAgentMemorySnapshots(): Promise<void> {
  await initAgentMemory();

  // 清除旧快照
  snapshotCache.clear();

  log.debug('Agent 记忆快照已冻结');
}

/**
 * 获取指定 Agent 类型的记忆快照
 *
 * 如果快照中已有缓存直接返回；否则读取磁盘文件。
 * 会话开始后，此函数始终返回冻结内容。
 *
 * @param typeId - Agent 类型 ID
 * @returns 记忆内容文本（若文件不存在则返回空字符串）
 */
export async function getAgentMemorySnapshot(typeId: string): Promise<string> {
  await initAgentMemory();

  // 检查快照缓存
  if (snapshotCache.has(typeId)) {
    return snapshotCache.get(typeId) ?? '';
  }

  // 首次读取时从磁盘加载并缓存
  const filePath = getMemoryFilePath(typeId);
  try {
    if (!existsSync(filePath)) {
      snapshotCache.set(typeId, '');
      return '';
    }
    const content = await readFile(filePath, 'utf-8');
    snapshotCache.set(typeId, content);
    return content;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('无法读取 Agent 记忆', { typeId, error: message });
    snapshotCache.set(typeId, '');
    return '';
  }
}

/**
 * 追加一条记忆到指定 Agent 类型
 *
 * 条目会自动加入时间戳前缀。
 * 如果条目数超过 MAX_ENTRIES，自动裁剪最旧的条目。
 *
 * @param typeId - Agent 类型 ID
 * @param content - 记忆内容
 * @returns 是否成功
 */
export async function appendAgentMemory(typeId: string, content: string): Promise<boolean> {
  await initAgentMemory();

  if (!content || content.trim().length === 0) {
    log.warn('忽略空记忆内容', { typeId });
    return false;
  }

  const trimmedContent =
    content.length > MAX_ENTRY_LENGTH ? `${content.slice(0, MAX_ENTRY_LENGTH)}...` : content;

  const filePath = getMemoryFilePath(typeId);
  const timestamp = new Date().toISOString();
  const entryContent = `[${timestamp}] ${trimmedContent}`;

  try {
    // 读取现有条目
    const existingEntries = await readAgentMemoryRaw(typeId);

    // 追加新条目
    existingEntries.push(entryContent);

    // 如果超过最大条目数，移除最旧的
    if (existingEntries.length > MAX_ENTRIES) {
      existingEntries.splice(0, existingEntries.length - MAX_ENTRIES);
    }

    // 序列化并写入
    const fileContent =
      existingEntries.length > 0 ? `§ ${existingEntries.join(SECTION_DELIMITER)}` : '';
    await atomicWrite(filePath, fileContent);

    log.debug('Agent 记忆已追加', { typeId, entryCount: existingEntries.length });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('无法写入 Agent 记忆', { typeId, error: message });
    return false;
  }
}

/**
 * 读取指定 Agent 类型的全部记忆（实时读取磁盘，非快照）
 *
 * @param typeId - Agent 类型 ID
 * @returns 记忆条目数组（按时间顺序）
 */
export async function readAgentMemory(typeId: string): Promise<string[]> {
  return readAgentMemoryRaw(typeId);
}

/**
 * 清空指定 Agent 类型的记忆
 *
 * @param typeId - Agent 类型 ID
 * @returns 是否成功
 */
export async function clearAgentMemory(typeId: string): Promise<boolean> {
  await initAgentMemory();

  const filePath = getMemoryFilePath(typeId);
  try {
    if (existsSync(filePath)) {
      await writeFile(filePath, '', 'utf-8');
      snapshotCache.delete(typeId);
      log.info('Agent 记忆已清空', { typeId });
    }
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('无法清空 Agent 记忆', { typeId, error: message });
    return false;
  }
}

/**
 * 获取记忆文件路径
 */
export function getMemoryFilePath(typeId: string): string {
  return join(AGENT_MEMORY_DIR, `${typeId}.md`);
}

/**
 * 重置快照缓存（测试用）
 */
export function resetMemorySnapshots(): void {
  snapshotCache.clear();
  initPromise = null;
}

// ============ 内部实现 ============

/**
 * 读取指定 Agent 类型的原始记忆条目
 *
 * 解析 § 分隔的文件格式，返回条目数组。
 */
async function readAgentMemoryRaw(typeId: string): Promise<string[]> {
  await initAgentMemory();

  const filePath = getMemoryFilePath(typeId);
  try {
    if (!existsSync(filePath)) {
      return [];
    }
    const content = await readFile(filePath, 'utf-8');
    if (content.trim().length === 0) {
      return [];
    }
    // Strip leading '§ ' if present
    const stripped = content.startsWith('§ ') ? content.slice(2) : content;
    if (stripped.trim().length === 0) {
      return [];
    }
    return stripped
      .split(SECTION_DELIMITER)
      .map((e) => e.trim())
      .filter((e) => e.length > 0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('无法读取 Agent 记忆', { typeId, error: message });
    return [];
  }
}

/**
 * 原子写入：先写临时文件，再 rename
 *
 * 防止写入过程中进程崩溃导致文件损坏。
 */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, content, 'utf-8');
  await rename(tmpPath, filePath);
}
