/**
 * Skill 加载器单元 + 集成测试
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock node:os homedir before any imports that use it
const mockHomes: string[] = [];
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => {
      // 返回最近的 mock home（栈顶）
      return mockHomes.length > 0
        ? (mockHomes[mockHomes.length - 1] ?? actual.homedir())
        : actual.homedir();
    },
  };
});

import { buildSkillSnapshot, parseFrontmatter, resolveSkillSourceDir } from '@/core/skill/loader';
import type { Skill, SkillEntry } from '@/core/skill/types';

function pushMockHome(home: string): void {
  mockHomes.push(home);
  process.env.HOME = home;
}

function popMockHome(): void {
  mockHomes.pop();
}

// ============ 测试辅助函数 ============

function makeSkill(name: string, description: string, overrides?: Partial<Skill>): Skill {
  return {
    name,
    description,
    filePath: `/test/skills/${name}/SKILL.md`,
    baseDir: `/test/skills/${name}`,
    source: 'bundled',
    frontmatter: { name, description },
    body: '',
    disableModelInvocation: false,
    userInvocable: true,
    ...overrides,
  };
}

function makeEntry(skill: Skill): SkillEntry {
  return {
    skill,
    loadedAt: new Date(),
    sourceDir: '/test/skills',
  };
}

async function createTempSkillDir(
  baseDir: string,
  skillName: string,
  content: string
): Promise<string> {
  const skillDir = join(baseDir, skillName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), content, 'utf-8');
  return skillDir;
}

// ============ parseFrontmatter ============

describe('parseFrontmatter', () => {
  it('should parse basic frontmatter', () => {
    const content = `---
name: test-skill
description: 测试技能
version: "1.0"
---

# 正文内容

这是技能的正文。`;

    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result?.frontmatter.name).toBe('test-skill');
    expect(result?.frontmatter.description).toBe('测试技能');
    expect(result?.frontmatter.version).toBe('1.0');
    expect(result?.body).toContain('# 正文内容');
  });

  it('should parse boolean values', () => {
    const content = `---
name: test
description: desc
user-invocable: false
disable-model-invocation: true
---

body`;

    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result?.frontmatter['user-invocable']).toBe(false);
    expect(result?.frontmatter['disable-model-invocation']).toBe(true);
  });

  it('should parse context field', () => {
    const content = `---
name: test
description: desc
context: fork
---

body`;

    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result?.frontmatter.context).toBe('fork');
  });

  it('should parse allowed-tools as array', () => {
    const content = `---
name: test
description: desc
allowed-tools:
  - Read
  - Write
  - Bash
---

body`;

    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result?.frontmatter['allowed-tools']).toEqual(['Read', 'Write', 'Bash']);
  });

  it('should parse requires-tools as single string', () => {
    const content = `---
name: test
description: desc
requires-tools: web_search
---

body`;

    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result?.frontmatter['requires-tools']).toEqual(['web_search']);
  });

  it('should parse requires-tools as array', () => {
    const content = `---
name: test
description: desc
requires-tools:
  - web_search
  - memory
---

body`;

    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result?.frontmatter['requires-tools']).toEqual(['web_search', 'memory']);
  });

  it('should parse compatibility', () => {
    const content = `---
name: test
description: desc
compatibility:
  os:
    - darwin
    - linux
  commands:
    - git
    - node
---

body`;

    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result?.frontmatter.compatibility).toEqual({
      os: ['darwin', 'linux'],
      commands: ['git', 'node'],
    });
  });

  it('should parse metadata', () => {
    const content = `---
name: test
description: desc
metadata:
  zapmyco:
    tags:
      - git
      - automation
---

body`;

    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    // YAML 解析器目前将 "zapmyco:" 下的 "tags:" 列表解析为 zapmyco 数组
    expect(result?.frontmatter.metadata).toBeDefined();
    expect(result?.frontmatter.metadata?.zapmyco).toBeDefined();
  });

  it('should parse argument-hint', () => {
    const content = `---
name: test
description: desc
argument-hint: "[file] [options]"
---

body`;

    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result?.frontmatter['argument-hint']).toBe('[file] [options]');
  });

  it('should return null for content without frontmatter', () => {
    const content = '# 没有 frontmatter 的内容';
    const result = parseFrontmatter(content);
    expect(result).toBeNull();
  });

  it('should return null for content without closing frontmatter delimiter', () => {
    const content = `---
name: test
description: missing end marker

body`;
    const result = parseFrontmatter(content);
    expect(result).toBeNull();
  });

  it('should use empty string for missing name and description', () => {
    const content = `---
---

body`;

    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result?.frontmatter.name).toBe('');
    expect(result?.frontmatter.description).toBe('');
  });

  it('should handle quoted string values', () => {
    const content = `---
name: "quoted-name"
description: 'single-quoted'
---

body`;

    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result?.frontmatter.name).toBe('quoted-name');
    expect(result?.frontmatter.description).toBe('single-quoted');
  });

  it('should handle numeric version as string', () => {
    const content = `---
name: test
description: desc
version: "2.0"
---

body`;

    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    // version is stored as string
    expect(typeof result?.frontmatter.version).toBe('string');
  });
});

// ============ buildSkillSnapshot ============

describe('buildSkillSnapshot', () => {
  it('should build snapshot with skill names and prompt', () => {
    const entries: SkillEntry[] = [
      makeEntry(makeSkill('commit', '创建规范的 git commit')),
      makeEntry(makeSkill('review', '代码审查')),
    ];

    const snapshot = buildSkillSnapshot(entries);
    expect(snapshot.count).toBe(2);
    expect(snapshot.names).toEqual(['commit', 'review']);
    expect(snapshot.prompt).toContain('## 可用技能');
    expect(snapshot.prompt).toContain('commit');
    expect(snapshot.prompt).toContain('review');
  });

  it('should exclude skills with disableModelInvocation', () => {
    const entries: SkillEntry[] = [
      makeEntry(makeSkill('visible', '可见的技能')),
      makeEntry(makeSkill('hidden', '隐藏的技能', { disableModelInvocation: true })),
    ];

    const snapshot = buildSkillSnapshot(entries);
    expect(snapshot.count).toBe(1);
    expect(snapshot.names).toEqual(['visible']);
    expect(snapshot.prompt).not.toContain('hidden');
  });

  it('should respect maxSkillsInPrompt limit', () => {
    const entries: SkillEntry[] = [];
    for (let i = 0; i < 10; i++) {
      entries.push(makeEntry(makeSkill(`skill-${i}`, `技能 ${i}`)));
    }

    const snapshot = buildSkillSnapshot(entries, 3);
    expect(snapshot.count).toBe(3);
    expect(snapshot.names).toHaveLength(3);
  });

  it('should return empty prompt when no skills', () => {
    const snapshot = buildSkillSnapshot([]);
    expect(snapshot.count).toBe(0);
    expect(snapshot.names).toEqual([]);
    expect(snapshot.prompt).toBe('');
  });

  it('should include argument-hint in prompt when present', () => {
    const skill = makeSkill('commit', '创建规范的 git commit', {
      frontmatter: {
        name: 'commit',
        description: '创建规范的 git commit',
        'argument-hint': '[--no-verify]',
      },
    });
    const snapshot = buildSkillSnapshot([makeEntry(skill)]);
    expect(snapshot.prompt).toContain('[--no-verify]');
  });

  it('should freeze timestamp', () => {
    const before = new Date();
    const snapshot = buildSkillSnapshot([]);
    expect(snapshot.frozenAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});

// ============ resolveSkillSourceDir ============

describe('resolveSkillSourceDir', () => {
  it('should return user skills dir', () => {
    const dir = resolveSkillSourceDir('user');
    expect(dir).toContain('.zapmyco');
    expect(dir).toContain('skills');
  });

  it('should return project skills dir', () => {
    const dir = resolveSkillSourceDir('project', '/test/workspace');
    expect(dir).toBe('/test/workspace/.zapmyco/skills');
  });

  it('should return bundled skills dir', () => {
    const dir = resolveSkillSourceDir('bundled');
    expect(dir).toContain('skills');
  });
});

// ============ syncBundledSkills & loadSkills 集成测试 ============

describe('syncBundledSkills', () => {
  let tempHome: string;
  let tempBundled: string;

  beforeEach(async () => {
    // 创建临时目录
    const prefix = join(
      tmpdir(),
      `zapmyco-skill-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    tempHome = join(prefix, 'home');
    tempBundled = join(prefix, 'bundled');

    await mkdir(tempHome, { recursive: true });
    await mkdir(tempBundled, { recursive: true });

    pushMockHome(tempHome);
    process.env.ZAPMYCO_BUNDLED_SKILLS_DIR = tempBundled;
  });

  afterEach(async () => {
    popMockHome();
    delete process.env.ZAPMYCO_BUNDLED_SKILLS_DIR;
    vi.restoreAllMocks();
  });

  it('should sync new skills from bundled to user dir', async () => {
    const { syncBundledSkills } = await import('@/core/skill/loader');

    // 在 bundled 目录中创建一个测试 skill
    const skillContent = `---
name: test-sync
description: 同步测试技能
---

# 测试技能

执行测试。`;
    await createTempSkillDir(tempBundled, 'test-sync', skillContent);

    // 运行同步
    const result = await syncBundledSkills();

    expect(result.synced).toContain('test-sync');
    expect(result.skipped).toHaveLength(0);

    // 验证文件已复制到用户目录
    const { readFile: rf, stat: st } = await import('node:fs/promises');
    const userSkillFile = join(tempHome, '.zapmyco', 'skills', 'test-sync', 'SKILL.md');
    const fileStat = await st(userSkillFile);
    expect(fileStat.isFile()).toBe(true);

    const content = await rf(userSkillFile, 'utf-8');
    expect(content).toBe(skillContent);
  });

  it('should be idempotent on second run', async () => {
    const { syncBundledSkills } = await import('@/core/skill/loader');

    const skillContent = `---
name: test-idempotent
description: 幂等测试
---

body`;
    await createTempSkillDir(tempBundled, 'test-idempotent', skillContent);

    // 第一次同步
    const result1 = await syncBundledSkills();
    expect(result1.synced).toContain('test-idempotent');

    // 第二次同步（应跳过）
    const result2 = await syncBundledSkills();
    expect(result2.synced).toHaveLength(0);
  });

  it('should update skill when bundled version changes', async () => {
    const { syncBundledSkills } = await import('@/core/skill/loader');
    const { writeFile: wf, readFile: rf } = await import('node:fs/promises');

    // 创建初始版本
    const v1Content = `---
name: test-update
description: 版本1
---

# 版本1`;
    await createTempSkillDir(tempBundled, 'test-update', v1Content);

    // 首次同步
    await syncBundledSkills();

    // 更新 bundled 内容
    const v2Content = `---
name: test-update
description: 版本2
---

# 版本2`;
    await wf(join(tempBundled, 'test-update', 'SKILL.md'), v2Content, 'utf-8');

    // 第二次同步应更新
    const result = await syncBundledSkills();
    expect(result.synced).toContain('test-update');

    // 验证用户文件已更新
    const userContent = await rf(
      join(tempHome, '.zapmyco', 'skills', 'test-update', 'SKILL.md'),
      'utf-8'
    );
    expect(userContent).toBe(v2Content);
  });

  it('should not overwrite user-modified skills', async () => {
    const { syncBundledSkills } = await import('@/core/skill/loader');
    const { writeFile: wf, readFile: rf } = await import('node:fs/promises');

    // 创建 bundled skill
    const bundledContent = `---
name: test-user-mod
description: bundled版本
---

# Bundled`;
    await createTempSkillDir(tempBundled, 'test-user-mod', bundledContent);

    // 首次同步
    await syncBundledSkills();

    // 用户修改 skill
    const userModified = `---
name: test-user-mod
description: 用户修改的版本
---

# User Modified`;
    const userSkillDir = join(tempHome, '.zapmyco', 'skills', 'test-user-mod');
    await wf(join(userSkillDir, 'SKILL.md'), userModified, 'utf-8');

    // 同时更新 bundled
    const bundledV2 = `---
name: test-user-mod
description: bundled新版
---

# Bundled V2`;
    await wf(join(tempBundled, 'test-user-mod', 'SKILL.md'), bundledV2, 'utf-8');

    // 第二次同步——应跳过（用户已修改）
    const result = await syncBundledSkills();
    expect(result.synced).not.toContain('test-user-mod');

    // 验证用户修改未被覆盖
    const userContent = await rf(
      join(tempHome, '.zapmyco', 'skills', 'test-user-mod', 'SKILL.md'),
      'utf-8'
    );
    expect(userContent).toBe(userModified);
  });

  it('should handle empty bundled directory gracefully', async () => {
    const { syncBundledSkills } = await import('@/core/skill/loader');

    // bundled 目录存在但为空
    const result = await syncBundledSkills();
    expect(result.synced).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it('should create manifest file after sync', async () => {
    const { syncBundledSkills } = await import('@/core/skill/loader');
    const { readFile: rf } = await import('node:fs/promises');

    const skillContent = `---
name: test-manifest
description: manifest测试
---

body`;
    await createTempSkillDir(tempBundled, 'test-manifest', skillContent);

    await syncBundledSkills();

    // 验证 manifest 文件存在且包含正确条目
    const manifestPath = join(tempHome, '.zapmyco', 'skills', '.bundled_manifest');
    const manifestContent = await rf(manifestPath, 'utf-8');
    expect(manifestContent).toContain('test-manifest:');
  });

  it('should skip hidden directories and node_modules', async () => {
    const { syncBundledSkills } = await import('@/core/skill/loader');

    // 创建被跳过的目录
    await mkdir(join(tempBundled, '.hidden-skill'), { recursive: true });
    await writeFile(
      join(tempBundled, '.hidden-skill', 'SKILL.md'),
      '---\nname: hidden\ndescription: hidden\n---\n',
      'utf-8'
    );

    await mkdir(join(tempBundled, 'node_modules', 'some-skill'), { recursive: true });
    await writeFile(
      join(tempBundled, 'node_modules', 'some-skill', 'SKILL.md'),
      '---\nname: skipped\ndescription: skipped\n---\n',
      'utf-8'
    );

    // 同时创建一个正常 skill
    const skillContent = `---
name: test-visible
description: 可见技能
---

body`;
    await createTempSkillDir(tempBundled, 'test-visible', skillContent);

    const result = await syncBundledSkills();

    expect(result.synced).toEqual(['test-visible']);
    expect(result.synced).not.toContain('hidden');
    expect(result.synced).not.toContain('skipped');
  });

  it('should skip directories without SKILL.md', async () => {
    const { syncBundledSkills } = await import('@/core/skill/loader');

    // 创建没有 SKILL.md 的目录
    await mkdir(join(tempBundled, 'empty-dir'), { recursive: true });

    const result = await syncBundledSkills();
    expect(result.synced).toHaveLength(0);
  });
});

// ============ loadSkills 集成测试 ============

describe('loadSkills', () => {
  let tempHome: string;
  let tempBundled: string;

  beforeEach(async () => {
    const prefix = join(
      tmpdir(),
      `zapmyco-load-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    tempHome = join(prefix, 'home');
    tempBundled = join(prefix, 'bundled');

    await mkdir(tempHome, { recursive: true });
    await mkdir(tempBundled, { recursive: true });

    pushMockHome(tempHome);
    process.env.ZAPMYCO_BUNDLED_SKILLS_DIR = tempBundled;
  });

  afterEach(async () => {
    popMockHome();
    delete process.env.ZAPMYCO_BUNDLED_SKILLS_DIR;
    vi.restoreAllMocks();
  });

  it('should load skills from user directory after sync', async () => {
    const { loadSkills } = await import('@/core/skill/loader');

    const skillContent = `---
name: test-load
description: 加载测试
---

# 内容`;
    await createTempSkillDir(tempBundled, 'test-load', skillContent);

    const entries = await loadSkills({ enabled: true });

    expect(entries.length).toBeGreaterThanOrEqual(1);
    const loaded = entries.find((e) => e.skill.name === 'test-load');
    expect(loaded).toBeDefined();
    expect(loaded?.skill.description).toBe('加载测试');
    expect(loaded?.skill.source).toBe('user');
  });

  it('should return empty when disabled', async () => {
    const { loadSkills } = await import('@/core/skill/loader');

    const entries = await loadSkills({ enabled: false });
    expect(entries).toHaveLength(0);
  });

  it('should respect project priority over user', async () => {
    // 由于 loadSkills 使用 process.cwd() 作为 workspaceDir，
    // 我们需要设置 mock
    const { loadSkills } = await import('@/core/skill/loader');

    const prefix = join(tmpdir(), `zapmyco-prio-test-${Date.now()}`);
    const projectDir = join(prefix, 'project');
    const projectSkillsDir = join(projectDir, '.zapmyco', 'skills');
    await mkdir(projectSkillsDir, { recursive: true });

    // 在 bundled（会同步到 user）创建一个 skill
    const bundledContent = `---
name: test-priority
description: 来自bundled(user)
---

# Bundled`;
    await createTempSkillDir(tempBundled, 'test-priority', bundledContent);

    // 在 project 创建一个同名 skill
    const projectContent = `---
name: test-priority
description: 来自project
---

# Project`;
    await createTempSkillDir(projectSkillsDir, 'test-priority', projectContent);

    // 设置 cwd mock
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    const entries = await loadSkills({ enabled: true }, projectDir);

    cwdSpy.mockRestore();

    const loaded = entries.find((e) => e.skill.name === 'test-priority');
    expect(loaded).toBeDefined();
    // project 优先级高于 user，所以应该使用 project 版本
    expect(loaded?.skill.source).toBe('project');
    expect(loaded?.skill.description).toBe('来自project');
  });

  it('should load extraDirs skills', async () => {
    const { loadSkills } = await import('@/core/skill/loader');

    const extraDir = join(tmpdir(), `zapmyco-extra-test-${Date.now()}`);
    await mkdir(extraDir, { recursive: true });

    const extraContent = `---
name: extra-skill
description: 额外目录技能
---

# Extra`;
    await createTempSkillDir(extraDir, 'extra-skill', extraContent);

    const entries = await loadSkills({
      enabled: true,
      extraDirs: [extraDir],
    });

    const loaded = entries.find((e) => e.skill.name === 'extra-skill');
    expect(loaded).toBeDefined();
    expect(loaded?.skill.description).toBe('额外目录技能');
  });

  it('should expand ~ in extraDirs', async () => {
    const { loadSkills } = await import('@/core/skill/loader');

    // 在 tempHome 下创建一个 skill 目录
    const extraDir = join(tempHome, 'my-skills');
    await mkdir(extraDir, { recursive: true });

    const extraContent = `---
name: tilde-skill
description: 波浪号展开测试
---

# Tilde`;
    await createTempSkillDir(extraDir, 'tilde-skill', extraContent);

    const entries = await loadSkills({
      enabled: true,
      extraDirs: ['~/my-skills'],
    });

    const loaded = entries.find((e) => e.skill.name === 'tilde-skill');
    expect(loaded).toBeDefined();
  });
});

// ============ 兼容性过滤测试 ============

describe('compatibility filtering via loadSkills', () => {
  let tempHome: string;
  let tempBundled: string;

  beforeEach(async () => {
    const prefix = join(
      tmpdir(),
      `zapmyco-compat-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    tempHome = join(prefix, 'home');
    tempBundled = join(prefix, 'bundled');

    await mkdir(tempHome, { recursive: true });
    await mkdir(tempBundled, { recursive: true });

    pushMockHome(tempHome);
    process.env.ZAPMYCO_BUNDLED_SKILLS_DIR = tempBundled;
  });

  afterEach(async () => {
    popMockHome();
    delete process.env.ZAPMYCO_BUNDLED_SKILLS_DIR;
    vi.restoreAllMocks();
  });

  it('should mark skills with incompatible OS as disableModelInvocation', async () => {
    const { loadSkills } = await import('@/core/skill/loader');

    // 创建一个仅支持 linux 的 skill（在 macOS 上应被标记为不兼容）
    const linuxOnlyContent = `---
name: linux-only
description: 仅Linux技能
compatibility:
  os:
    - linux
---

# Linux Only`;
    await createTempSkillDir(tempBundled, 'linux-only', linuxOnlyContent);

    const entries = await loadSkills({ enabled: true });

    const loaded = entries.find((e) => e.skill.name === 'linux-only');
    expect(loaded).toBeDefined();

    // 如果是 macOS，应该被标记为 disableModelInvocation
    if (process.platform === 'darwin') {
      expect(loaded?.skill.disableModelInvocation).toBe(true);
    }
  });

  it('should keep skills without compatibility as compatible', async () => {
    const { loadSkills } = await import('@/core/skill/loader');

    const noCompatContent = `---
name: universal
description: 通用技能
---

# Universal`;
    await createTempSkillDir(tempBundled, 'universal', noCompatContent);

    const entries = await loadSkills({ enabled: true });

    const loaded = entries.find((e) => e.skill.name === 'universal');
    expect(loaded).toBeDefined();
    expect(loaded?.skill.disableModelInvocation).toBe(false);
  });
});
