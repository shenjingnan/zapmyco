/**
 * Skill 工具单元测试
 */

import { describe, expect, it, vi } from 'vitest';

// 直接测试 skill-tool 中的导出函数
// 通过动态导入来获取内部函数

describe('SkillTool', () => {
  describe('getSkillCommandSpecs', () => {
    it('should return specs for user-invocable skills', async () => {
      const { getSkillCommandSpecs } = await import('@/cli/repl/tools/skill-tool');

      const entries = [
        {
          skill: {
            name: 'commit',
            description: '创建规范的 git commit',
            filePath: '/test/skills/commit/SKILL.md',
            baseDir: '/test/skills/commit',
            source: 'bundled' as const,
            frontmatter: { name: 'commit', description: '创建规范的 git commit' },
            body: '',
            disableModelInvocation: false,
            userInvocable: true,
          },
          loadedAt: new Date(),
          sourceDir: '/test/skills',
        },
        {
          skill: {
            name: 'hidden-skill',
            description: '不应该出现在命令列表中',
            filePath: '/test/skills/hidden/SKILL.md',
            baseDir: '/test/skills/hidden',
            source: 'bundled' as const,
            frontmatter: { name: 'hidden-skill', description: '' },
            body: '',
            disableModelInvocation: false,
            userInvocable: false,
          },
          loadedAt: new Date(),
          sourceDir: '/test/skills',
        },
      ];

      const specs = getSkillCommandSpecs(entries);
      expect(specs).toHaveLength(1);
      expect(specs[0]?.name).toBe('commit');
    });
  });

  describe('setSkillEntries / getSkillEntries', () => {
    it('should store and retrieve skill entries', async () => {
      const { getSkillEntries, setSkillEntries } = await import('@/cli/repl/tools/skill-tool');

      const entries = [
        {
          skill: {
            name: 'test',
            description: 'test skill',
            filePath: '/test/SKILL.md',
            baseDir: '/test',
            source: 'bundled' as const,
            frontmatter: { name: 'test', description: 'test skill' },
            body: '',
            disableModelInvocation: false,
            userInvocable: true,
          },
          loadedAt: new Date(),
          sourceDir: '/test',
        },
      ];

      setSkillEntries(entries);
      expect(getSkillEntries()).toHaveLength(1);
      expect(getSkillEntries()[0]?.skill.name).toBe('test');
    });
  });

  describe('createSkillTool', () => {
    it('should return a tool with correct id', async () => {
      const { createSkillTool, setSkillEntries } = await import('@/cli/repl/tools/skill-tool');

      // 需要设置条目
      setSkillEntries([
        {
          skill: {
            name: 'commit',
            description: '创建规范的 git commit',
            filePath: '/test/skills/commit/SKILL.md',
            baseDir: '/test/skills/commit',
            source: 'bundled',
            frontmatter: {
              name: 'commit',
              description: '创建规范的 git commit',
              'allowed-tools': ['Bash', 'Read'],
            },
            body: '# Git Commit 技能\n\n创建规范 commit',
            disableModelInvocation: false,
            userInvocable: true,
          },
          loadedAt: new Date(),
          sourceDir: '/test/skills',
        },
      ]);

      const tool = createSkillTool();
      expect(tool.id).toBe('Skill');
      expect(tool.parameters.required).toContain('skill');
    });

    it('should return error for non-existent skill', async () => {
      const { createSkillTool, setSkillEntries } = await import('@/cli/repl/tools/skill-tool');

      setSkillEntries([]);
      const tool = createSkillTool();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await tool.execute('call-1', { skill: 'nonexistent' });

      expect(result.content[0].text).toContain('未找到技能');
    });

    it('should find skill by name (case-insensitive)', async () => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      // 创建临时 Skill 文件
      const tmpDir = path.join('/tmp', `zapmyco-skill-test-${Date.now()}`);
      const skillDir = path.join(tmpDir, 'test-skill');
      await fs.mkdir(skillDir, { recursive: true });

      const skillContent = `---
name: test-skill
description: 测试技能
allowed-tools:
  - Read
  - Bash
---

# 测试技能

执行测试步骤：

1. 读取文件
2. 运行命令

参数: $ARGUMENTS
目录: \${ZAPMYCO_SKILL_DIR}
`;

      await vi.waitFor(() => fs.writeFile(path.join(skillDir, 'SKILL.md'), skillContent, 'utf-8'));

      const { createSkillTool, setSkillEntries } = await import('@/cli/repl/tools/skill-tool');

      setSkillEntries([
        {
          skill: {
            name: 'test-skill',
            description: '测试技能',
            filePath: path.join(skillDir, 'SKILL.md'),
            baseDir: skillDir,
            source: 'bundled',
            frontmatter: {
              name: 'test-skill',
              description: '测试技能',
              'allowed-tools': ['Read', 'Bash'],
            },
            body: skillContent,
            disableModelInvocation: false,
            userInvocable: true,
          },
          loadedAt: new Date(),
          sourceDir: tmpDir,
        },
      ]);

      const tool = createSkillTool();

      // 大小写不敏感查找
      const result = await tool.execute('call-2', {
        skill: 'TEST-SKILL',
        args: '--verbose file.txt',
      });

      expect(result.content[0].text).toContain('test-skill');
      expect(result.content[0].text).toContain('--verbose file.txt');
      expect(result.content[0].text).toContain('Base directory');
      expect(result.content[0].text).toContain(skillDir);

      // 清理
      await fs.rm(tmpDir, { recursive: true, force: true });
    });
  });
});
