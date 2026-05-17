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

    it('should return error for empty skill name', async () => {
      const { createSkillTool } = await import('@/cli/repl/tools/skill-tool');

      const tool = createSkillTool();
      // biome-ignore lint/suspicious/noExplicitAny: test parameter
      const result = await tool.execute('call-3', { skill: '' } as any);

      expect(result.content[0].text).toContain('请提供要调用的技能名称');
    });

    it('should return error for whitespace-only skill name', async () => {
      const { createSkillTool } = await import('@/cli/repl/tools/skill-tool');

      const tool = createSkillTool();
      // biome-ignore lint/suspicious/noExplicitAny: test parameter
      const result = await tool.execute('call-4', { skill: '   ' } as any);

      expect(result.content[0].text).toContain('请提供要调用的技能名称');
    });

    it('should handle missing args gracefully', async () => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      const tmpDir = path.join('/tmp', `zapmyco-skill-test-${Date.now()}`);
      const skillDir = path.join(tmpDir, 'no-args');
      await fs.mkdir(skillDir, { recursive: true });

      const skillContent = `---
name: no-args
description: 无参数技能
---

# 无参数

正常执行即可。`;

      await vi.waitFor(() => fs.writeFile(path.join(skillDir, 'SKILL.md'), skillContent, 'utf-8'));

      const { createSkillTool, setSkillEntries } = await import('@/cli/repl/tools/skill-tool');

      setSkillEntries([
        {
          skill: {
            name: 'no-args',
            description: '无参数技能',
            filePath: path.join(skillDir, 'SKILL.md'),
            baseDir: skillDir,
            source: 'bundled',
            frontmatter: { name: 'no-args', description: '无参数技能' },
            body: skillContent,
            disableModelInvocation: false,
            userInvocable: true,
          },
          loadedAt: new Date(),
          sourceDir: tmpDir,
        },
      ]);

      const tool = createSkillTool();
      const result = await tool.execute('call-5', { skill: 'no-args' });

      expect(result.content[0].text).toContain('no-args');
      expect(result.content[0].text).toContain('正常执行即可');

      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('should list available skills when skill not found', async () => {
      const { createSkillTool, setSkillEntries } = await import('@/cli/repl/tools/skill-tool');

      setSkillEntries([
        {
          skill: {
            name: 'existing',
            description: '存在的技能',
            filePath: '/tmp/existing/SKILL.md',
            baseDir: '/tmp/existing',
            source: 'bundled',
            frontmatter: { name: 'existing', description: '存在的技能' },
            body: '',
            disableModelInvocation: false,
            userInvocable: true,
          },
          loadedAt: new Date(),
          sourceDir: '/tmp',
        },
      ]);

      const tool = createSkillTool();
      const result = await tool.execute('call-6', { skill: 'nonexistent' });

      expect(result.content[0].text).toContain('未找到技能');
      expect(result.content[0].text).toContain('existing');
    });
  });

  describe('getSkillCommandSpecs', () => {
    it('should sanitize skill names for commands', async () => {
      const { getSkillCommandSpecs } = await import('@/cli/repl/tools/skill-tool');

      const entries = [
        {
          skill: {
            name: 'My Skill!',
            description: 'test',
            filePath: '/test/SKILL.md',
            baseDir: '/test',
            source: 'bundled' as const,
            frontmatter: { name: 'My Skill!', description: 'test' },
            body: '',
            disableModelInvocation: false,
            userInvocable: true,
          },
          loadedAt: new Date(),
          sourceDir: '/test',
        },
      ];

      const specs = getSkillCommandSpecs(entries);
      expect(specs).toHaveLength(1);
      // 名称应被规范化为小写，非字母数字替换为连字符
      expect(specs[0]?.name).toBe('my-skill');
    });
  });

  describe('Shell 命令执行 (! 语法)', () => {
    const fs = () => import('node:fs/promises');
    const path = () => import('node:path');

    async function createSkillOnDisk(
      name: string,
      skillContent: string
    ): Promise<{ tmpDir: string; skillDir: string }> {
      const fsp = await fs();
      const pp = await path();
      const tmpDir = pp.join('/tmp', `zapmyco-shell-test-${Date.now()}`);
      const skillDir = pp.join(tmpDir, name);
      await fsp.mkdir(skillDir, { recursive: true });
      await fsp.writeFile(pp.join(skillDir, 'SKILL.md'), skillContent, 'utf-8');
      return { tmpDir, skillDir };
    }

    it('should execute ```! block command and replace with output', async () => {
      const fsp = await fs();
      const { createSkillTool, setSkillEntries } = await import('@/cli/repl/tools/skill-tool');

      const { tmpDir, skillDir } = await createSkillOnDisk(
        'test-shell',
        `---
name: test-shell
description: 测试 shell 命令
---

# 测试

运行命令:
\`\`\`!
echo "hello world"
\`\`\`

完成`
      );

      setSkillEntries([
        {
          skill: {
            name: 'test-shell',
            description: '测试 shell 命令',
            filePath: `${skillDir}/SKILL.md`,
            baseDir: skillDir,
            source: 'bundled',
            frontmatter: { name: 'test-shell', description: '测试 shell 命令' },
            body: '',
            disableModelInvocation: false,
            userInvocable: true,
          },
          loadedAt: new Date(),
          sourceDir: tmpDir,
        },
      ]);

      const tool = createSkillTool();
      const result = await tool.execute('call-shell-1', { skill: 'test-shell' });
      const text = result.content[0].text;

      expect(text).toContain('hello world');
      expect(text).not.toContain('```!');

      await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    it('should execute !`inline` command and replace with output', async () => {
      const fsp = await fs();
      const { createSkillTool, setSkillEntries } = await import('@/cli/repl/tools/skill-tool');

      const { tmpDir, skillDir } = await createSkillOnDisk(
        'test-inline',
        `---
name: test-inline
description: 测试行内命令
---

当前时间: !\`date +%Y\``
      );

      setSkillEntries([
        {
          skill: {
            name: 'test-inline',
            description: '测试行内命令',
            filePath: `${skillDir}/SKILL.md`,
            baseDir: skillDir,
            source: 'bundled',
            frontmatter: { name: 'test-inline', description: '测试行内命令' },
            body: '',
            disableModelInvocation: false,
            userInvocable: true,
          },
          loadedAt: new Date(),
          sourceDir: tmpDir,
        },
      ]);

      const tool = createSkillTool();
      const result = await tool.execute('call-inline', { skill: 'test-inline' });
      const text = result.content[0].text;

      expect(text).toMatch(/\d{4}/);
      // 行内语法标记应被替换
      expect(text).not.toContain('!`');

      await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    it('should block dangerous commands and not execute them', async () => {
      const fsp = await fs();
      const { createSkillTool, setSkillEntries } = await import('@/cli/repl/tools/skill-tool');

      const { tmpDir, skillDir } = await createSkillOnDisk(
        'test-danger',
        `---
name: test-danger
description: 测试危险命令
---

# 危险

\`\`\`!
rm -rf /
\`\`\``
      );

      setSkillEntries([
        {
          skill: {
            name: 'test-danger',
            description: '测试危险命令',
            filePath: `${skillDir}/SKILL.md`,
            baseDir: skillDir,
            source: 'bundled',
            frontmatter: { name: 'test-danger', description: '测试危险命令' },
            body: '',
            disableModelInvocation: false,
            userInvocable: true,
          },
          loadedAt: new Date(),
          sourceDir: tmpDir,
        },
      ]);

      const tool = createSkillTool();
      const result = await tool.execute('call-danger', { skill: 'test-danger' });
      const text = result.content[0].text;

      // 应提示阻断而不是真正执行
      expect(text).toContain('阻断');
      expect(text).toContain('rm -rf');

      await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    it('should pass through when no shell commands present', async () => {
      const fsp = await fs();
      const { createSkillTool, setSkillEntries } = await import('@/cli/repl/tools/skill-tool');

      const { tmpDir, skillDir } = await createSkillOnDisk(
        'plain-skill',
        `---
name: plain-skill
description: 纯文本技能
---

# 纯文本技能

直接执行即可。`
      );

      setSkillEntries([
        {
          skill: {
            name: 'plain-skill',
            description: '纯文本技能',
            filePath: `${skillDir}/SKILL.md`,
            baseDir: skillDir,
            source: 'bundled',
            frontmatter: { name: 'plain-skill', description: '纯文本技能' },
            body: '',
            disableModelInvocation: false,
            userInvocable: true,
          },
          loadedAt: new Date(),
          sourceDir: tmpDir,
        },
      ]);

      const tool = createSkillTool();
      const result = await tool.execute('call-plain', { skill: 'plain-skill' });
      const text = result.content[0].text;

      expect(text).toContain('纯文本技能');
      expect(text).toContain('直接执行即可');

      await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    it('should handle multiple shell commands', async () => {
      const fsp = await fs();
      const { createSkillTool, setSkillEntries } = await import('@/cli/repl/tools/skill-tool');

      const { tmpDir, skillDir } = await createSkillOnDisk(
        'test-multi',
        `---
name: test-multi
description: 测试多命令
---

\`\`\`!
echo "first"
\`\`\`
中间的文本
\`\`\`!
echo "second"
\`\`\``
      );

      setSkillEntries([
        {
          skill: {
            name: 'test-multi',
            description: '测试多命令',
            filePath: `${skillDir}/SKILL.md`,
            baseDir: skillDir,
            source: 'bundled',
            frontmatter: { name: 'test-multi', description: '测试多命令' },
            body: '',
            disableModelInvocation: false,
            userInvocable: true,
          },
          loadedAt: new Date(),
          sourceDir: tmpDir,
        },
      ]);

      const tool = createSkillTool();
      const result = await tool.execute('call-multi', { skill: 'test-multi' });
      const text = result.content[0].text;

      expect(text).toContain('first');
      expect(text).toContain('second');
      expect(text).toContain('中间的文本');

      await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    it('should show exit code for non-zero exit', async () => {
      const fsp = await fs();
      const { createSkillTool, setSkillEntries } = await import('@/cli/repl/tools/skill-tool');

      const { tmpDir, skillDir } = await createSkillOnDisk(
        'test-exit',
        `---
name: test-exit
description: 测试退出码
---

\`\`\`!
exit 42
\`\`\``
      );

      setSkillEntries([
        {
          skill: {
            name: 'test-exit',
            description: '测试退出码',
            filePath: `${skillDir}/SKILL.md`,
            baseDir: skillDir,
            source: 'bundled',
            frontmatter: { name: 'test-exit', description: '测试退出码' },
            body: '',
            disableModelInvocation: false,
            userInvocable: true,
          },
          loadedAt: new Date(),
          sourceDir: tmpDir,
        },
      ]);

      const tool = createSkillTool();
      const result = await tool.execute('call-exit', { skill: 'test-exit' });
      const text = result.content[0].text;

      expect(text).toContain('退出码: 42');

      await fsp.rm(tmpDir, { recursive: true, force: true });
    });
  });
});
