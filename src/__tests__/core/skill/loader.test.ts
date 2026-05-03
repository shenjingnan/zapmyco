/**
 * Skill 加载器单元测试
 */

import { describe, expect, it } from 'vitest';
import { buildSkillSnapshot, parseFrontmatter } from '@/core/skill/loader';
import type { Skill, SkillEntry } from '@/core/skill/types';

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
});

describe('buildSkillSnapshot', () => {
  function makeSkill(name: string, description: string, disableModelInvocation = false): Skill {
    return {
      name,
      description,
      filePath: `/test/skills/${name}/SKILL.md`,
      baseDir: `/test/skills/${name}`,
      source: 'bundled',
      frontmatter: { name, description },
      body: '',
      disableModelInvocation,
      userInvocable: true,
    };
  }

  function makeEntry(skill: Skill): SkillEntry {
    return {
      skill,
      loadedAt: new Date(),
      sourceDir: '/test/skills',
    };
  }

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
      makeEntry(makeSkill('hidden', '隐藏的技能', true)),
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
});
