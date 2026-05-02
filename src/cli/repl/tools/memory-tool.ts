/**
 * memory 工具实现 — 持久化记忆管理
 *
 * 参考 Hermes-Agent 的 memory_tool.py（单工具 + action 模式、§ 分隔符、快照冻结）
 * 和 Claude Code 的类型分类（user/project/session 三种记忆类型）。
 *
 * 设计要点:
 * - 存储位置: ~/.zapmyco/memory/
 * - 条目分隔符: §（Section Sign，借鉴 Hermes）
 * - 快照冻结: 会话开始时冻结内容到快照，会话中写入不影响当前系统提示
 * - 原子写入: 先写临时文件，再 rename（防部分写入）
 * - 自动去重: add 时检查是否已存在相同内容
 *
 * @module cli/repl/tools/memory-tool
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ============ 类型定义 ============

export type MemoryType = 'user' | 'project' | 'session';
export type MemoryAction = 'read' | 'add' | 'remove' | 'list';

export interface MemoryParams {
  action?: MemoryAction;
  type?: MemoryType;
  content?: string;
  old_content?: string;
}

// ============ 常量 ============

const MEMORY_DIR = join(homedir(), '.zapmyco', 'memory');
const SECTION_DELIMITER = '\n§ ';
const MAX_CONTENT_LENGTH = 2000;

const MEMORY_FILES: Record<MemoryType, string> = {
  user: 'user.md',
  project: 'project.md',
  session: 'session.md',
};

const MEMORY_LABELS: Record<MemoryType, string> = {
  user: '用户画像',
  project: '项目上下文',
  session: '会话摘要',
};

// ============ MemoryStore ============

/**
 * 持久化记忆存储
 *
 * 管理 ~/.zapmyco/memory/ 目录下的记忆文件。
 * 采用快照模式：会话开始时冻结内容到快照，会话中写入不影响快照。
 */
export class MemoryStore {
  private baseDir: string;
  private snapshot: Map<MemoryType, string> = new Map();
  private initialized = false;

  constructor(homeDir?: string) {
    this.baseDir = homeDir ? join(homeDir, '.zapmyco', 'memory') : MEMORY_DIR;
  }

  // ============ 初始化 ============

  /** 确保目录和默认文件存在 */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.baseDir, { recursive: true });

    // 为每种类型创建默认文件（如果不存在）
    for (const [type, filename] of Object.entries(MEMORY_FILES)) {
      const filepath = join(this.baseDir, filename);
      try {
        await readFile(filepath, 'utf-8');
      } catch {
        const header = this.buildFileHeader(type as MemoryType);
        await writeFile(filepath, header, 'utf-8');
      }
    }

    // 创建索引文件
    const indexPath = join(this.baseDir, 'MEMORY.md');
    try {
      await readFile(indexPath, 'utf-8');
    } catch {
      await this.updateIndex();
    }

    this.initialized = true;
  }

  // ============ 快照管理 ============

  /** 冻结当前记忆内容为快照（会话开始时调用） */
  async freezeSnapshot(): Promise<void> {
    await this.initialize();
    for (const type of Object.keys(MEMORY_FILES) as MemoryType[]) {
      const content = await this.readFileContent(type);
      this.snapshot.set(type, content);
    }
  }

  /** 获取快照内容（用于系统提示注入，不触发文件读取） */
  getSnapshot(type?: MemoryType): string {
    if (type) {
      return this.snapshot.get(type) ?? '';
    }
    // 返回所有类型的快照摘要
    const parts: string[] = [];
    for (const [t, content] of this.snapshot) {
      if (content.trim()) {
        parts.push(`### ${MEMORY_LABELS[t as MemoryType]}\n${content}`);
      }
    }
    return parts.join('\n\n') || '(暂无记忆)';
  }

  // ============ CRUD 操作 ============

  /** 读取指定类型记忆 */
  async read(type: MemoryType): Promise<string> {
    await this.initialize();
    return this.readFileContent(type);
  }

  /** 添加一条记忆条目 */
  async add(type: MemoryType, content: string): Promise<{ ok: boolean; error?: string }> {
    await this.initialize();

    // 内容校验
    if (!content?.trim()) {
      return { ok: false, error: '内容不能为空' };
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      return { ok: false, error: `内容过长（最大 ${MAX_CONTENT_LENGTH} 字符）` };
    }

    const existing = await this.readFileContent(type);
    const entries = this.parseEntries(existing);

    // 去重检查
    const normalized = content.trim();
    if (entries.some((e) => e.trim() === normalized)) {
      return { ok: false, error: '该条目已存在' };
    }

    entries.push(normalized);
    await this.writeFileContent(type, entries);
    await this.updateIndex();

    return { ok: true };
  }

  /** 删除匹配的记忆条目 */
  async remove(type: MemoryType, oldContent: string): Promise<{ ok: boolean; error?: string }> {
    await this.initialize();

    if (!oldContent?.trim()) {
      return { ok: false, error: 'old_content 不能为空' };
    }

    const existing = await this.readFileContent(type);
    const entries = this.parseEntries(existing);
    const search = oldContent.trim();

    const matches = entries.filter((e) => e.includes(search));

    if (matches.length === 0) {
      return { ok: false, error: '未找到匹配的条目' };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        error: `找到 ${matches.length} 个匹配项，请提供更精确的 old_content。匹配条目:\n${matches.map((m) => `  § ${m}`).join('\n')}`,
      };
    }

    const newEntries = entries.filter((e) => !e.includes(search));
    await this.writeFileContent(type, newEntries);
    await this.updateIndex();

    return { ok: true };
  }

  /** 列出所有记忆索引 */
  async list(): Promise<string> {
    await this.initialize();

    const indexPath = join(this.baseDir, 'MEMORY.md');
    try {
      const content = await readFile(indexPath, 'utf-8');
      return content || '暂无记忆索引。';
    } catch {
      return '暂无记忆索引。';
    }
  }

  // ============ 内部方法 ============

  private buildFileHeader(type: MemoryType): string {
    const label = MEMORY_LABELS[type];
    const now = new Date().toISOString();
    return `# ${label}\n\n> 更新: ${now}\n\n`;
  }

  private parseEntries(content: string): string[] {
    // 提取 § 分隔的条目（跳过文件头部元数据）
    const entries: string[] = [];
    const parts = content.split(SECTION_DELIMITER);
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (part) {
        const trimmed = part.trim();
        if (trimmed) entries.push(trimmed);
      }
    }
    return entries;
  }

  private entriesToContent(type: MemoryType, entries: string[]): string {
    const header = this.buildFileHeader(type);
    if (entries.length === 0) return header;
    return header + SECTION_DELIMITER.trimStart() + entries.join(SECTION_DELIMITER);
  }

  private async readFileContent(type: MemoryType): Promise<string> {
    const filepath = join(this.baseDir, MEMORY_FILES[type]);
    try {
      return await readFile(filepath, 'utf-8');
    } catch {
      return this.buildFileHeader(type);
    }
  }

  /** 原子写入：先写临时文件，再 rename */
  private async writeFileContent(type: MemoryType, entries: string[]): Promise<void> {
    const filepath = join(this.baseDir, MEMORY_FILES[type]);
    const tmpPath = `${filepath}.tmp`;
    const content = this.entriesToContent(type, entries);
    await writeFile(tmpPath, content, 'utf-8');
    await rename(tmpPath, filepath);
  }

  private async updateIndex(): Promise<void> {
    const lines: string[] = ['# Memory Index', ''];

    for (const [type, filename] of Object.entries(MEMORY_FILES)) {
      const content = await this.readFileContent(type as MemoryType);
      const count = this.parseEntries(content).length;
      const label = MEMORY_LABELS[type as MemoryType];
      lines.push(`- [${filename}](${filename}) — ${label}（${count} 条）`);
    }

    const indexPath = join(this.baseDir, 'MEMORY.md');
    await writeFile(indexPath, lines.join('\n'), 'utf-8');
  }
}

// ============ 工具描述 ============

const MEMORY_DESCRIPTION = `持久化记忆管理工具 — 跨会话保存和检索信息，让 Agent "越用越懂用户"。

## 记忆类型 (type)
- "user": 用户画像 — 偏好、习惯、知识背景、角色
- "project": 项目上下文 — 决策、约定、目标
- "session": 会话摘要 — 最近会话的关键结论或进展

## 操作 (action)
- "read": 读取指定类型的记忆内容
- "add": 添加一条记忆条目（自动去重）
- "remove": 删除匹配的记忆条目（需提供 old_content 精确匹配）
- "list": 列出 MEMORY.md 索引摘要

## 何时保存记忆
- 用户明确告知偏好、习惯、知识背景时 → 保存到 user
- 项目做出重要决策或约定时 → 保存到 project
- 会话结束时有值得跨会话保留的结论 → 保存到 session
- 用户纠正你的行为或给出反馈时 → 保存到 user

## 何时不保存
- 临时任务进度、会话状态（使用 task_manage 管理）
- 代码细节（可直接从代码库获取）
- 一次性查询的内容`;

// ============ 工具工厂 ============

/** 全局单例 MemoryStore（会话级生命周期） */
let globalStore: MemoryStore | null = null;

/**
 * 获取或创建 MemoryStore 实例
 */
export function getMemoryStore(): MemoryStore {
  if (!globalStore) {
    globalStore = new MemoryStore();
  }
  return globalStore;
}

/**
 * 创建 memory 工具
 */
export function createMemoryTool() {
  const store = getMemoryStore();

  return {
    id: 'memory' as const,
    label: '记忆管理',
    description: MEMORY_DESCRIPTION,
    parameters: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string' as const,
          description: '操作类型: "read"(读取), "add"(添加), "remove"(删除), "list"(列出索引)。',
          enum: ['read', 'add', 'remove', 'list'],
        },
        type: {
          type: 'string' as const,
          description:
            '记忆类型: "user"(用户画像), "project"(项目上下文), "session"(会话摘要)。read/add/remove 操作需要指定。',
          enum: ['user', 'project', 'session'],
        },
        content: {
          type: 'string' as const,
          description: '要添加的记忆内容（action="add" 时必填）',
        },
        old_content: {
          type: 'string' as const,
          description: '要删除的记忆内容（action="remove" 时必填，用于精确匹配已有条目）',
        },
      },
    } as const,

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async execute(_toolCallId: string, params: MemoryParams): Promise<any> {
      const action = params.action ?? 'read';
      const type = params.type ?? 'user';

      switch (action) {
        case 'read':
          return buildReadResult(store, type);
        case 'add':
          return buildAddResult(store, type, params.content);
        case 'remove':
          return buildRemoveResult(store, type, params.old_content);
        case 'list':
          return buildListResult(store);
        default:
          return {
            content: [{ type: 'text', text: `不支持的操作: ${action}` }],
            details: { action, error: `不支持的操作: ${action}` },
          };
      }
    },
  };
}

// ============ 操作实现 ============

async function buildReadResult(store: MemoryStore, type: MemoryType) {
  const content = await store.read(type);
  const label = MEMORY_LABELS[type];

  if (!content.trim() || content.trim() === `# ${label}`) {
    return {
      content: [{ type: 'text', text: `${label}暂无记忆条目。使用 action="add" 添加。` }],
      details: { action: 'read', type, content: '' },
    };
  }

  return {
    content: [{ type: 'text', text: content }],
    details: { action: 'read', type, content },
  };
}

async function buildAddResult(store: MemoryStore, type: MemoryType, content?: string) {
  if (!content) {
    return {
      content: [{ type: 'text', text: '请提供 content 参数（要保存的记忆内容）。' }],
      details: { action: 'add', type, error: 'content 参数为空' },
    };
  }

  const result = await store.add(type, content);

  if (!result.ok) {
    return {
      content: [{ type: 'text', text: `[保存失败] ${result.error}` }],
      details: { action: 'add', type, error: result.error },
    };
  }

  const label = MEMORY_LABELS[type];
  return {
    content: [{ type: 'text', text: `已保存到${label}:\n§ ${content.trim()}` }],
    details: { action: 'add', type, content: content.trim() },
  };
}

async function buildRemoveResult(store: MemoryStore, type: MemoryType, oldContent?: string) {
  if (!oldContent) {
    return {
      content: [
        { type: 'text', text: '请提供 old_content 参数（要删除的记忆内容，用于匹配已有条目）。' },
      ],
      details: { action: 'remove', type, error: 'old_content 参数为空' },
    };
  }

  const result = await store.remove(type, oldContent);

  if (!result.ok) {
    return {
      content: [{ type: 'text', text: `[删除失败] ${result.error}` }],
      details: { action: 'remove', type, error: result.error },
    };
  }

  const label = MEMORY_LABELS[type];
  return {
    content: [{ type: 'text', text: `已从${label}删除匹配条目。` }],
    details: { action: 'remove', type, removed: oldContent.trim() },
  };
}

async function buildListResult(store: MemoryStore) {
  const content = await store.list();
  return {
    content: [{ type: 'text', text: content }],
    details: { action: 'list', content },
  };
}
