/**
 * 用户自定义 Agent 加载器
 *
 * 启动时扫描用户级和项目级 Agent 定义文件，解析并注册到 AgentTypeRegistry。
 *
 * 加载路径：
 * - 用户级: ~/.zapmyco/agents/*.md
 * - 项目级: <project>/.zapmyco/agents/*.md
 *
 * 文件格式: YAML frontmatter + Markdown body（参见 markdown-agent-parser）
 *
 * @module core/agent-team
 */

import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getAgentTypeRegistry } from '@/core/agent-team/agent-type-registry';
import { logger } from '@/infra/logger';
import { parseAgentMarkdownBatch } from './markdown-agent-parser';

const log = logger.child('user-agent-loader');

/**
 * 用户级 Agent 目录
 *
 * ~/.zapmyco/agents/
 */
function getUserAgentsDir(): string {
  return join(homedir(), '.zapmyco', 'agents');
}

/**
 * 项目级 Agent 目录
 *
 * <project>/.zapmyco/agents/
 */
function getProjectAgentsDir(workdir?: string): string {
  return join(workdir ?? process.cwd(), '.zapmyco', 'agents');
}

// ============ 加载结果 ============

/** 加载结果 */
export interface LoadResult {
  /** 成功加载的定义数量 */
  loaded: number;
  /** 跳过的数量（disabled 或已存在） */
  skipped: number;
  /** 错误信息 */
  errors: Array<{ filePath: string; messages: string[] }>;
  /** 成功加载的定义详情 */
  typeIds: string[];
  /** 来源 */
  source: 'user' | 'project';
}

// ============ 公共 API ============

/**
 * 加载用户级 Agent 定义文件
 *
 * 扫描 ~/.zapmyco/agents/*.md，解析并注册到全局 AgentTypeRegistry。
 * 如果目录不存在则静默跳过。
 *
 * @returns LoadResult
 */
export async function loadUserAgents(): Promise<LoadResult> {
  const dir = getUserAgentsDir();
  return loadFromDirectory(dir, 'user');
}

/**
 * 加载项目级 Agent 定义文件
 *
 * 扫描 <project>/.zapmyco/agents/*.md，解析并注册到全局 AgentTypeRegistry。
 * 如果目录不存在则静默跳过。
 *
 * @param workdir - 项目工作目录（默认 process.cwd()）
 * @returns LoadResult
 */
export async function loadProjectAgents(workdir?: string): Promise<LoadResult> {
  const dir = getProjectAgentsDir(workdir);
  return loadFromDirectory(dir, 'project');
}

/**
 * 加载所有 Agent 定义（用户级 + 项目级）
 *
 * 加载顺序：先项目级，后用户级。
 * 后加载的（用户级）可以覆盖先加载的（项目级）同名 typeId。
 *
 * @param workdir - 项目工作目录
 * @returns 两级 LoadResult
 */
export async function loadAllAgents(workdir?: string): Promise<{
  project: LoadResult;
  user: LoadResult;
}> {
  const projectResult = await loadProjectAgents(workdir);
  const userResult = await loadUserAgents();
  return { project: projectResult, user: userResult };
}

/**
 * 重新加载 Agent 定义（先卸载，再加载）
 *
 * 卸载所有非 builtin 的 Agent 类型，然后重新扫描加载。
 *
 * @param workdir - 项目工作目录
 */
export async function reloadAgents(workdir?: string): Promise<{
  project: LoadResult;
  user: LoadResult;
}> {
  const registry = getAgentTypeRegistry();

  // 卸载所有非 builtin 类型
  const allTypes = registry.listAll();
  for (const def of allTypes) {
    if (def.source !== 'builtin') {
      registry.unregister(def.typeId);
    }
  }

  log.info('已卸载所有自定义 Agent 类型，重新加载');
  return loadAllAgents(workdir);
}

// ============ 内部实现 ============

/**
 * 从指定目录加载 Agent 定义文件
 */
async function loadFromDirectory(dir: string, source: 'user' | 'project'): Promise<LoadResult> {
  const registry = getAgentTypeRegistry();

  if (!existsSync(dir)) {
    log.debug('Agent 定义目录不存在，跳过', { dir, source });
    return { loaded: 0, skipped: 0, errors: [], typeIds: [], source };
  }

  // 1. 扫描 *.md 文件
  let entries: string[];
  try {
    const dirEntries = await readdir(dir, { withFileTypes: true });
    entries = dirEntries.filter((d) => d.isFile() && d.name.endsWith('.md')).map((d) => d.name);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('无法读取 Agent 定义目录', { dir, error: message });
    return {
      loaded: 0,
      skipped: 0,
      errors: [{ filePath: dir, messages: [`无法读取目录: ${message}`] }],
      typeIds: [],
      source,
    };
  }

  if (entries.length === 0) {
    log.debug('Agent 定义目录为空', { dir, source });
    return { loaded: 0, skipped: 0, errors: [], typeIds: [], source };
  }

  // 2. 读取所有文件内容
  const files: Array<{ filePath: string; content: string }> = [];
  for (const entry of entries) {
    const filePath = join(dir, entry);
    try {
      // 检查文件大小（跳过大于 100KB 的文件）
      const fileStat = await stat(filePath);
      if (fileStat.size > 100 * 1024) {
        log.warn('Agent 定义文件过大，跳过', { filePath, size: fileStat.size });
        continue;
      }

      const content = await readFile(filePath, 'utf-8');
      files.push({ filePath, content });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('无法读取 Agent 定义文件', { filePath, error: message });
    }
  }

  // 3. 批量解析
  const { definitions, errors } = parseAgentMarkdownBatch(files, source);

  // 4. 注册到 Registry
  let loaded = 0;
  let skipped = 0;
  const typeIds: string[] = [];

  for (const def of definitions) {
    const existing = registry.get(def.typeId);
    if (existing && existing.source === 'builtin') {
      log.warn('不能覆盖内置 Agent 类型', {
        typeId: def.typeId,
        existingSource: existing.source,
      });
      errors.push({
        filePath: `typeId:${def.typeId}`,
        messages: [`不能覆盖内置 Agent 类型 "${def.typeId}"`],
      });
      skipped++;
      continue;
    }

    // 检查是否符合配置的 agentTypes 过滤
    registry.register(def);
    loaded++;
    typeIds.push(def.typeId);
    log.info(`注册${source === 'user' ? '用户' : '项目'}级 Agent 类型`, {
      typeId: def.typeId,
      displayName: def.displayName,
    });
  }

  log.info(`Agent 类型加载完成 (${source})`, {
    scanned: entries.length,
    loaded,
    skipped,
    errors: errors.length,
  });

  return { loaded, skipped, errors, typeIds, source };
}

/**
 * 获取 Agent 定义目录路径（供外部使用，如 CLI 命令）
 */
export { getProjectAgentsDir, getUserAgentsDir };
