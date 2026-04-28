/**
 * 会话历史存储
 *
 * 基于内存的环形缓冲区，记录 REPL 会话中的用户输入和执行结果。
 */

import type { HistoryEntry, HistoryStore as IHistoryStore } from './types.js';

/** 默认最大历史条数 */
const DEFAULT_MAX_SIZE = 100;

/**
 * 历史存储类
 */
export class HistoryStore implements IHistoryStore {
  private entries: HistoryEntry[] = [];
  private nextId = 1;
  private readonly maxSize: number;

  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
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
      // shift 后重新编号以保持 ID 连续（可选，这里选择保持递增）
    }

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

  /** 清空所有条目 */
  clear(): void {
    this.entries = [];
    // 不重置 nextId，保持 ID 唯一递增
  }

  /** 搜索条目（按输入内容模糊匹配） */
  search(query: string): HistoryEntry[] {
    const lowerQuery = query.toLowerCase();
    return this.entries.filter((entry) => entry.input.toLowerCase().includes(lowerQuery));
  }
}

/** 类型别名（供 session 内部引用） */
export type HistoryStoreImpl = HistoryStore;
