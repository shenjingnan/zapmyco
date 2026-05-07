/**
 * 会话历史存储
 *
 * 基于内存的环形缓冲区，记录 REPL 会话中的用户输入和执行结果。
 * 支持文件持久化到 ~/.zapmyco/history.json，跨会话恢复。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { HistoryEntry, HistoryStore as IHistoryStore } from '@/cli/repl/types';
import { SESSION_DIR_NAME } from '@/infra/constants';
import { logger } from '@/infra/logger';

const log = logger.child('history:store');

/** 默认最大历史条数 */
const DEFAULT_MAX_SIZE = 100;

/** 历史文件存储路径 */
function getHistoryFilePath(): string {
  return join(homedir(), SESSION_DIR_NAME, 'history.json');
}

/**
 * 历史存储类
 */
export class HistoryStore implements IHistoryStore {
  private entries: HistoryEntry[] = [];
  private nextId = 1;
  private readonly maxSize: number;
  private readonly filePath: string;

  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
    this.filePath = getHistoryFilePath();
    this.load();
  }

  /** 添加条目 */
  push(entry: Omit<HistoryEntry, 'id'>): HistoryEntry {
    const newEntry: HistoryEntry = {
      ...entry,
      id: this.nextId++,
    };

    this.entries.push(newEntry);

    // 超过最大容量时淘汰最旧的条目
    if (this.entries.length > this.maxSize) {
      this.entries.shift();
    }

    // 持久化到文件
    this.save();

    return newEntry;
  }

  /** 获取所有条目 */
  getAll(): HistoryEntry[] {
    return [...this.entries];
  }

  /** 获取最近 n 条 */
  getLast(n: number): HistoryEntry[] {
    const count = Math.min(n, this.entries.length);
    return this.entries.slice(-count);
  }

  /** 清空所有条目（同时清除持久化文件） */
  clear(): void {
    this.entries = [];
    this.save();
  }

  /** 搜索条目（按输入内容模糊匹配） */
  search(query: string): HistoryEntry[] {
    const lowerQuery = query.toLowerCase();
    return this.entries.filter((entry) => entry.input.toLowerCase().includes(lowerQuery));
  }

  /** 从文件加载历史记录 */
  private load(): void {
    try {
      ensureDir(dirname(this.filePath));
      const raw = readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as { entries: HistoryEntry[]; nextId: number };
      if (Array.isArray(data.entries)) {
        this.entries = data.entries.slice(-this.maxSize);
        this.nextId = typeof data.nextId === 'number' ? data.nextId : 1;
        log.debug('历史记录已加载', { count: this.entries.length, nextId: this.nextId });
      }
    } catch {
      // 文件不存在或损坏时静默降级为空历史
      log.debug('无历史文件或加载失败，使用空历史');
    }
  }

  /** 持久化历史记录到文件 */
  private save(): void {
    try {
      ensureDir(dirname(this.filePath));
      const data = JSON.stringify({ entries: this.entries, nextId: this.nextId }, null, 2);
      writeFileSync(this.filePath, data, 'utf-8');
    } catch (err: unknown) {
      log.warn('历史记录保存失败', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** 确保目录存在 */
function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/** 类型别名（供 session 内部引用） */
export type HistoryStoreImpl = HistoryStore;
