/**
 * Skill 加载器 — 多源扫描、解析、去重、同步
 *
 * 技能统一管理在 ~/.zapmyco/skills/ 目录。
 * 启动时自动将 bundled skills（随 npm 包发布）同步到用户目录。
 *
 * 来源优先级：project > user（user 已包含 synced bundled）
 *
 * @module core/skill/loader
 */

import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Skill,
  SkillEntry,
  SkillFrontmatter,
  SkillLoadConfig,
  SkillSnapshot,
  SkillSource,
} from './types';

// ============ 常量 ============

const SKILL_FILE = 'SKILL.md';
const BUNDLED_MANIFEST = '.bundled_manifest';

const DEFAULT_MAX_SKILLS_IN_PROMPT = 50;
const DEFAULT_MAX_SKILL_FILE_BYTES = 256 * 1024; // 256KB

/** 来源优先级（数字越大优先级越高） */
const SOURCE_PRIORITY: Record<SkillSource, number> = {
  bundled: 1,
  user: 2,
  project: 3,
};

// ============ 路径解析 ============

/** 用户 skills 目录（统一管理位置） */
function getUserSkillsDir(): string {
  return join(homedir(), '.zapmyco', 'skills');
}

/** 项目 skills 目录 */
function getProjectSkillsDir(workspaceDir?: string): string {
  return join(workspaceDir ?? process.cwd(), '.zapmyco', 'skills');
}

/**
 * 解析 bundled skills 源目录
 *
 * 从当前模块路径向上查找包含 package.json 的目录，
 * 再拼接 skills/ 子目录。
 *
 * 开发模式：找到项目根目录 skills/
 * 生产模式：找到 npm 包根目录 skills/
 */
function resolveBundledSkillsDir(): string {
  if (process.env.ZAPMYCO_BUNDLED_SKILLS_DIR) {
    return process.env.ZAPMYCO_BUNDLED_SKILLS_DIR;
  }

  try {
    const __filename = fileURLToPath(import.meta.url);
    let dir = dirname(__filename);
    for (let i = 0; i < 10; i++) {
      // 检查是否存在 package.json + skills/ 目录（npm 包根目录标记）
      const skillsDir = join(dir, 'skills');
      if (dirHasPackageJson(dir) && dirHasSkillsDir(dir)) {
        return skillsDir;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // ESM 环境无法获取 __filename 时回退
  }

  return resolve(process.cwd(), 'skills');
}

function dirHasPackageJson(dir: string): boolean {
  try {
    statSync(join(dir, 'package.json'));
    return true;
  } catch {
    return false;
  }
}

function dirHasSkillsDir(dir: string): boolean {
  try {
    return statSync(join(dir, 'skills')).isDirectory();
  } catch {
    return false;
  }
}

/** 来源目录路径解析器 */
const SOURCE_DIRS: Record<SkillSource, (workspaceDir?: string) => string> = {
  bundled: () => resolveBundledSkillsDir(),
  user: () => getUserSkillsDir(),
  project: (workspaceDir?: string) => getProjectSkillsDir(workspaceDir),
};

// ============ Bundled Skills 同步 ============

/**
 * 将 bundled skills 同步到 ~/.zapmyco/skills/
 *
 * 使用 manifest 文件（~/.zapmyco/skills/.bundled_manifest）跟踪：
 *   skill_name:content_hash
 *
 * 同步规则：
 * - 用户目录不存在该 skill → 复制
 * - 用户目录存在且 manifest hash 匹配 bundled → 更新（新版本覆盖）
 * - 用户目录存在但 manifest hash 不匹配 → 跳过（用户已修改）
 */
export async function syncBundledSkills(): Promise<{ synced: string[]; skipped: string[] }> {
  const bundledDir = resolveBundledSkillsDir();
  const userDir = getUserSkillsDir();

  await mkdir(userDir, { recursive: true });

  // 读取 bundled skills
  const bundledSkills: { name: string; dirPath: string }[] = [];
  try {
    const entries = await readdir(bundledDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue;
      }
      const skillFile = join(bundledDir, entry.name, SKILL_FILE);
      try {
        const st = await stat(skillFile);
        if (st.isFile()) {
          bundledSkills.push({ name: entry.name, dirPath: join(bundledDir, entry.name) });
        }
      } catch {
        // 无 SKILL.md，跳过
      }
    }
  } catch {
    // bundled 目录不存在
    return { synced: [], skipped: [] };
  }

  // 读取 manifest
  const manifestPath = join(userDir, BUNDLED_MANIFEST);
  const manifest = await loadManifest(manifestPath);

  const synced: string[] = [];
  const skipped: string[] = [];

  for (const { name, dirPath } of bundledSkills) {
    const bundledSkillFile = join(dirPath, SKILL_FILE);
    const userSkillDir = join(userDir, name);
    const userSkillFile = join(userSkillDir, SKILL_FILE);

    try {
      const bundledContent = await readFile(bundledSkillFile, 'utf-8');
      const bundledHash = hashContent(bundledContent);

      const manifestHash = manifest[name];
      const userExists = await fileExists(userSkillFile);

      if (!userExists) {
        // 新安装
        await mkdir(userSkillDir, { recursive: true });
        await copyFile(bundledSkillFile, userSkillFile);
        manifest[name] = bundledHash;
        synced.push(name);
      } else if (manifestHash && manifestHash === bundledHash) {
        // 已经是当前版本，跳过
      } else if (manifestHash && manifestHash !== bundledHash) {
        // bundled 有新版本，用户未修改 → 更新
        await copyFile(bundledSkillFile, userSkillFile);
        manifest[name] = bundledHash;
        synced.push(name);
      } else {
        // 用户在 manifest 中无记录或 hash 不匹配 → 用户可能已修改，跳过
        skipped.push(name);
      }
    } catch (_err) {
      // 单个 skill 同步失败不影响整体
      skipped.push(name);
    }
  }

  // 保存 manifest
  await writeManifest(manifestPath, manifest);

  return { synced, skipped };
}

async function loadManifest(path: string): Promise<Record<string, string>> {
  try {
    const content = await readFile(path, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    const manifest: Record<string, string> = {};
    for (const line of lines) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const name = line.slice(0, idx).trim();
        const hash = line.slice(idx + 1).trim();
        manifest[name] = hash;
      }
    }
    return manifest;
  } catch {
    return {};
  }
}

async function writeManifest(path: string, manifest: Record<string, string>): Promise<void> {
  const lines = Object.entries(manifest)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, hash]) => `${name}:${hash}`);
  await writeFile(path, lines.join('\n') + '\n', 'utf-8');
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// ============ Frontmatter 解析 ============

/**
 * 简易 YAML frontmatter 解析器
 *
 * 仅解析顶层的 key: value 格式，支持：
 * - 字符串值（支持引号和无引号）
 * - 布尔值（true/false）
 * - 字符串数组（- item 格式）
 * - 嵌套对象（缩进格式，仅一层）
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  let currentKey: string | null = null;
  let currentArray: string[] = [];
  let currentNested: Record<string, unknown> | null = null;
  let nestedKey: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (!line.trim() || line.trim().startsWith('#')) continue;

    const nestedMatch = line.match(/^ {2}(\w[\w-]*):\s*(.*)/);
    if (nestedMatch) {
      const nKey = nestedMatch[1] ?? '';
      const nValue = nestedMatch[2]?.trim() ?? '';

      if (!currentNested) currentNested = {};
      nestedKey = nKey;

      if (nValue === '') {
        currentNested[nKey] = [];
      } else {
        currentNested[nKey] = parseYamlValue(nValue);
      }
      continue;
    }

    if (line.trim().startsWith('- ')) {
      if (nestedKey && currentNested && Array.isArray(currentNested[nestedKey])) {
        (currentNested[nestedKey] as string[]).push(line.trim().slice(2).trim());
      } else if (currentKey) {
        currentArray.push(line.trim().slice(2).trim());
      }
      continue;
    }

    const topMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (topMatch) {
      if (currentKey && currentArray.length > 0) {
        result[currentKey] = currentArray;
      } else if (currentKey && currentNested) {
        result[currentKey] = currentNested;
      }

      const key = topMatch[1] ?? '';
      const value = topMatch[2]?.trim() ?? '';

      currentKey = key;
      currentArray = [];
      currentNested = null;
      nestedKey = null;

      if (value === '') {
      } else {
        result[key] = parseYamlValue(value);
        currentKey = null;
      }
    }
  }

  if (currentKey && currentArray.length > 0) {
    result[currentKey] = currentArray;
  } else if (currentKey && currentNested) {
    result[currentKey] = currentNested;
  }

  return result;
}

function parseYamlValue(value: string): string | boolean | number {
  const trimmed = value.trim();

  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

/**
 * 从 Markdown 内容中解析 frontmatter
 */
export function parseFrontmatter(
  content: string
): { frontmatter: SkillFrontmatter; body: string } | null {
  const trimmed = content.trimStart();

  if (!trimmed.startsWith('---')) {
    return null;
  }

  const endIdx = trimmed.indexOf('---', 3);
  if (endIdx === -1) {
    return null;
  }

  const yamlBlock = trimmed.slice(3, endIdx);
  const body = trimmed.slice(endIdx + 3).trim();

  const raw = parseSimpleYaml(yamlBlock);

  const frontmatter: SkillFrontmatter = {
    name: String(raw.name ?? ''),
    description: String(raw.description ?? ''),
  };

  if (typeof raw.version === 'string') frontmatter.version = raw.version;
  if (raw['user-invocable'] !== undefined)
    frontmatter['user-invocable'] = Boolean(raw['user-invocable']);
  if (raw['disable-model-invocation'] !== undefined)
    frontmatter['disable-model-invocation'] = Boolean(raw['disable-model-invocation']);
  if (raw.context === 'inline' || raw.context === 'fork') frontmatter.context = raw.context;
  if (Array.isArray(raw['allowed-tools']))
    frontmatter['allowed-tools'] = raw['allowed-tools'] as string[];
  if (typeof raw['argument-hint'] === 'string') frontmatter['argument-hint'] = raw['argument-hint'];
  if (typeof raw['requires-tools'] === 'string') {
    frontmatter['requires-tools'] = [raw['requires-tools'] as string];
  } else if (Array.isArray(raw['requires-tools'])) {
    frontmatter['requires-tools'] = raw['requires-tools'] as string[];
  }

  if (raw.compatibility && typeof raw.compatibility === 'object') {
    const compat = raw.compatibility as Record<string, unknown>;
    frontmatter.compatibility = {};
    if (Array.isArray(compat.os)) frontmatter.compatibility.os = compat.os as string[];
    if (Array.isArray(compat.commands))
      frontmatter.compatibility.commands = compat.commands as string[];
  }

  if (raw.metadata && typeof raw.metadata === 'object') {
    frontmatter.metadata = raw.metadata as Record<string, unknown>;
  }

  return { frontmatter, body };
}

// ============ Skill 扫描与加载 ============

async function scanDirectory(
  dirPath: string,
  config: SkillLoadConfig
): Promise<{ path: string; content: string }[]> {
  const results: { path: string; content: string }[] = [];

  try {
    const dirStat = await stat(dirPath);
    if (!dirStat.isDirectory()) return results;
  } catch {
    return results;
  }

  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    const skillDir = join(dirPath, entry.name);
    const skillFilePath = join(skillDir, SKILL_FILE);

    try {
      const fileStat = await stat(skillFilePath);
      if (!fileStat.isFile()) continue;

      const maxBytes = config.maxSkillFileBytes ?? DEFAULT_MAX_SKILL_FILE_BYTES;
      if (fileStat.size > maxBytes) continue;

      const resolvedPath = resolve(skillFilePath);
      const resolvedDir = resolve(dirPath);
      if (!resolvedPath.startsWith(resolvedDir)) continue;

      const content = await readFile(skillFilePath, 'utf-8');
      results.push({ path: skillFilePath, content });
    } catch {
      // 静默跳过
    }
  }

  return results;
}

async function loadSkillsFromSource(
  source: SkillSource,
  sourceDir: string,
  config: SkillLoadConfig
): Promise<Skill[]> {
  const files = await scanDirectory(sourceDir, config);
  const skills: Skill[] = [];

  for (const { path, content } of files) {
    const parsed = parseFrontmatter(content);
    const dirName = path.split('/').slice(-2, -1)[0] ?? 'unknown';

    if (!parsed) {
      skills.push({
        name: dirName,
        description: '',
        filePath: path,
        baseDir: path.replace(`/${SKILL_FILE}`, ''),
        source,
        frontmatter: { name: dirName, description: '' },
        body: content,
        disableModelInvocation: false,
        userInvocable: true,
      });
      continue;
    }

    const { frontmatter, body } = parsed;

    skills.push({
      name: frontmatter.name || dirName,
      description: frontmatter.description,
      filePath: path,
      baseDir: path.replace(`/${SKILL_FILE}`, ''),
      source,
      frontmatter,
      body,
      disableModelInvocation: frontmatter['disable-model-invocation'] ?? false,
      userInvocable: frontmatter['user-invocable'] ?? true,
    });
  }

  return skills;
}

function mergeByPriority(skillGroups: Map<SkillSource, Skill[]>): SkillEntry[] {
  const merged = new Map<string, SkillEntry>();

  // 按优先级从高到低：project > user
  const orderedSources: SkillSource[] = ['project', 'user'];

  for (const source of orderedSources) {
    const skills = skillGroups.get(source);
    if (!skills) continue;

    for (const skill of skills) {
      const existing = merged.get(skill.name);

      if (!existing || SOURCE_PRIORITY[source] > SOURCE_PRIORITY[existing.skill.source]) {
        merged.set(skill.name, {
          skill,
          loadedAt: new Date(),
          sourceDir: SOURCE_DIRS[source](),
        });
      }
    }
  }

  return Array.from(merged.values());
}

function checkCompatibility(skill: Skill): { compatible: boolean; reason?: string } {
  const compat = skill.frontmatter.compatibility;
  if (!compat) return { compatible: true };

  if (compat.os && compat.os.length > 0) {
    const currentOS = process.platform;
    const osMap: Record<string, string> = {
      darwin: 'darwin',
      linux: 'linux',
      win32: 'win32',
      macos: 'darwin',
    };
    const osMatch = compat.os.some((os) => {
      const mapped = osMap[os.toLowerCase()] ?? os.toLowerCase();
      return mapped === currentOS;
    });
    if (!osMatch) {
      return { compatible: false, reason: `不支持的平台（需要: ${compat.os.join(', ')}）` };
    }
  }

  return { compatible: true };
}

// ============ 快照构建 ============

export function buildSkillSnapshot(
  entries: SkillEntry[],
  maxSkillsInPrompt?: number
): SkillSnapshot {
  const maxSkills = maxSkillsInPrompt ?? DEFAULT_MAX_SKILLS_IN_PROMPT;

  const visible = entries.filter((e) => !e.skill.disableModelInvocation).slice(0, maxSkills);

  const lines: string[] = [];
  for (const entry of visible) {
    const s = entry.skill;
    const hint = s.frontmatter['argument-hint'] ? ` ${s.frontmatter['argument-hint']}` : '';
    lines.push(`- ${s.name}${hint}: ${s.description || '(无描述)'}`);
  }

  const prompt =
    lines.length > 0
      ? `## 可用技能 (Skills)\n\n${lines.join('\n')}\n\n使用 Skill 工具调用技能。`
      : '';

  return {
    names: visible.map((e) => e.skill.name),
    prompt,
    frozenAt: new Date(),
    count: visible.length,
  };
}

// ============ 主加载函数 ============

/**
 * 加载所有 Skill
 *
 * 流程：
 * 1. 同步 bundled skills 到 ~/.zapmyco/skills/
 * 2. 从 user（~/.zapmyco/skills/）和 project（.zapmyco/skills/）加载
 * 3. 按优先级去重（project 覆盖 user）
 *
 * @param config - Skill 加载配置
 * @param workspaceDir - 工作区目录
 * @returns 去重合并后的 SkillEntry 列表
 */
export async function loadSkills(
  config: SkillLoadConfig,
  workspaceDir?: string
): Promise<SkillEntry[]> {
  if (!config.enabled) return [];

  // Step 1: 同步 bundled skills 到用户目录
  await syncBundledSkills();

  const baseDir = workspaceDir ?? process.cwd();
  const skillGroups = new Map<SkillSource, Skill[]>();

  // Step 2: 并行扫描 user 和 project 来源
  const sources: SkillSource[] = ['user', 'project'];
  const results = await Promise.all(
    sources.map(async (source) => {
      const dir = SOURCE_DIRS[source](baseDir);
      const skills = await loadSkillsFromSource(source, dir, config);

      const compatible = skills.map((skill) => {
        const check = checkCompatibility(skill);
        if (!check.compatible) {
          return { ...skill, disableModelInvocation: true };
        }
        return skill;
      });

      return { source, skills: compatible };
    })
  );

  for (const { source, skills } of results) {
    skillGroups.set(source, skills);
  }

  const merged = mergeByPriority(skillGroups);

  // 额外目录
  if (config.extraDirs && config.extraDirs.length > 0) {
    for (const extraDir of config.extraDirs) {
      const expanded = extraDir.startsWith('~')
        ? join(homedir(), extraDir.slice(1))
        : resolve(extraDir);
      const extraSkills = await loadSkillsFromSource('user', expanded, config);
      for (const skill of extraSkills) {
        if (!merged.some((e) => e.skill.name === skill.name)) {
          merged.push({ skill, loadedAt: new Date(), sourceDir: expanded });
        }
      }
    }
  }

  return merged;
}

export function resolveSkillSourceDir(source: SkillSource, workspaceDir?: string): string {
  return SOURCE_DIRS[source](workspaceDir);
}
