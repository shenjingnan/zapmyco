/**
 * Skill 工具实现 — 技能调用
 *
 * 将 Skill 作为 ToolRegistration 注册到 Agent，
 * 模型可主动调用此工具来执行预定义的技能工作流。
 *
 * 参考 Claude Code 的 SkillTool（inline 模式）和 Hermes-Agent 的 skill_view。
 *
 * @module cli/repl/tools/skill-tool
 */

import { readFile } from 'node:fs/promises';
import type { SkillEntry, SkillLoadConfig } from '@/core/skill/types';

// ============ 参数类型 ============

interface SkillToolParams {
  skill: string;
  args?: string;
}

// ============ 工具描述 ============

const SKILL_DESCRIPTION = `调用预定义的技能（Skill）来执行特定工作流。

技能是预定义的工作流模板，封装了完成特定任务所需的指令、工具调用和最佳实践。

## 如何使用
- 使用 skill 参数指定技能名称
- 使用可选的 args 参数传递参数（如文件名、选项等）
- 调用后技能内容会展开为当前对话的上下文，模型据此执行

## 示例
- skill: "commit" — 调用 commit 技能生成规范的 git commit
- skill: "review-pr", args: "123" — 调用 review-pr 技能审查指定的 PR`;

// ============ 全局状态 ============

/** 已加载的 Skill 条目（由外部注入） */
let skillEntries: SkillEntry[] = [];

/**
 * 更新已加载的 Skill 列表
 */
export function setSkillEntries(entries: SkillEntry[]): void {
  skillEntries = entries;
}

/**
 * 获取当前已加载的 Skill 列表
 */
export function getSkillEntries(): SkillEntry[] {
  return skillEntries;
}

// ============ 变量替换 ============

/**
 * 替换 Skill 内容中的模板变量
 *
 * 支持的变量：
 * - $ARGUMENTS / $ARGUMENTS[0] / $ARGUMENTS[1] — 按索引的参数
 * - $0 / $1 / $2 — 按索引的参数简写
 * - ${ZAPMYCO_SKILL_DIR} — Skill 目录绝对路径
 */
function substituteVariables(
  content: string,
  args: string | undefined,
  skillDir: string,
  skillName: string
): string {
  let result = content;

  // 替换 Skill 目录变量
  result = result.replace(/\$\{ZAPMYCO_SKILL_DIR\}/g, skillDir);
  result = result.replace(/\$\{SKILL_DIR\}/g, skillDir);

  // 解析参数
  const parsedArgs = parseArgs(args);

  // 替换 $ARGUMENTS（完整参数）
  result = result.replace(/\$ARGUMENTS\b/g, args ?? '');

  // 替换 $ARGUMENTS[N]
  result = result.replace(/\$ARGUMENTS\[(\d+)\]/g, (_match, idx) => {
    const i = parseInt(idx, 10);
    return parsedArgs[i] ?? '';
  });

  // 替换 $0, $1, $2, ...（按索引）
  result = result.replace(/\$(\d+)\b/g, (_match, idx) => {
    const i = parseInt(idx, 10);
    return parsedArgs[i] ?? '';
  });

  // 替换 $name（技能名称）
  result = result.replace(/\$name\b/g, skillName);

  return result;
}

/**
 * 简易参数解析（支持引号和转义）
 */
function parseArgs(args: string | undefined): string[] {
  if (!args) return [];

  const result: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < args.length; i++) {
    const ch = args[i] ?? '';

    if (inSingleQuote) {
      if (ch === "'") {
        inSingleQuote = false;
      } else {
        current += ch;
      }
    } else if (inDoubleQuote) {
      if (ch === '"') {
        inDoubleQuote = false;
      } else if (ch === '\\' && i + 1 < args.length) {
        i++;
        current += args[i] ?? '';
      } else {
        current += ch;
      }
    } else {
      if (ch === "'") {
        inSingleQuote = true;
      } else if (ch === '"') {
        inDoubleQuote = true;
      } else if (ch === ' ' || ch === '\t') {
        if (current.length > 0) {
          result.push(current);
          current = '';
        }
      } else {
        current += ch;
      }
    }
  }

  if (current.length > 0) {
    result.push(current);
  }

  return result;
}

// ============ 工具工厂 ============

/**
 * 创建 Skill 工具
 *
 * @param _config - Skill 加载配置（保留用于未来扩展）
 */
export function createSkillTool(_config?: SkillLoadConfig) {
  return {
    id: 'Skill' as const,
    label: '技能调用',
    description: SKILL_DESCRIPTION,
    parameters: {
      type: 'object' as const,
      properties: {
        skill: {
          type: 'string' as const,
          description: '要调用的技能名称（如 "commit"、"review-pr"）',
        },
        args: {
          type: 'string' as const,
          description: '传递给技能的可选参数（如文件名、选项等）',
        },
      },
      required: ['skill'],
    } as const,

    // biome-ignore lint/suspicious/noExplicitAny: ToolRegistration execute 接口要求 any
    async execute(_toolCallId: string, params: SkillToolParams): Promise<any> {
      const skillName = params.skill?.trim();
      if (!skillName) {
        return {
          content: [{ type: 'text', text: '请提供要调用的技能名称。' }],
          details: { error: 'skill 参数为空' },
        };
      }

      // 查找技能（不区分大小写）
      const entry = skillEntries.find(
        (e) => e.skill.name.toLowerCase() === skillName.toLowerCase()
      );

      if (!entry) {
        const available = skillEntries.map((e) => e.skill.name).join(', ');
        return {
          content: [
            {
              type: 'text',
              text: `未找到技能 "${skillName}"。\n\n可用技能: ${available || '(无)'}`,
            },
          ],
          details: { error: `技能 "${skillName}" 不存在`, available },
        };
      }

      const { skill } = entry;

      // 读取 SKILL.md 完整内容
      let content: string;
      try {
        content = await readFile(skill.filePath, 'utf-8');
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `读取技能文件失败: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: { error: '读取文件失败', path: skill.filePath },
        };
      }

      // 提取正文内容（跳过 frontmatter）
      let bodyContent = content;
      if (content.trimStart().startsWith('---')) {
        const endIdx = content.indexOf('---', 3);
        if (endIdx !== -1) {
          bodyContent = content.slice(endIdx + 3).trim();
        }
      }

      // 变量替换
      const substituted = substituteVariables(bodyContent, params.args, skill.baseDir, skill.name);

      // 构建返回内容
      const hint = skill.frontmatter['argument-hint']
        ? ` [${skill.frontmatter['argument-hint']}]`
        : '';

      const instructionParts: string[] = [
        `# Skill: ${skill.name}${hint}`,
        '',
        skill.description ? `> ${skill.description}` : '',
        '',
        '---',
        '',
        substituted,
        '',
        '---',
        `Base directory: ${skill.baseDir}`,
      ];

      if (!substituted.includes(params.args ?? '') && params.args) {
        instructionParts.push('', `ARGUMENTS: ${params.args}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: instructionParts.filter(Boolean).join('\n'),
          },
        ],
        details: {
          skill: skill.name,
          description: skill.description,
          source: skill.source,
          baseDir: skill.baseDir,
          context: skill.frontmatter.context ?? 'inline',
          allowedTools: skill.frontmatter['allowed-tools'] ?? [],
          args: params.args,
        },
      };
    },
  };
}

// ============ 辅助函数 ============

/**
 * 从 Skill 条目列表获取命令规格（用于自动注册斜杠命令）
 */
export function getSkillCommandSpecs(
  entries: SkillEntry[]
): Array<{ name: string; description: string; isSkill: true }> {
  return entries
    .filter((e) => e.skill.userInvocable)
    .map((e) => ({
      name: sanitizeSkillCommandName(e.skill.name),
      description: e.skill.description || `调用 ${e.skill.name} 技能`,
      isSkill: true as const,
    }));
}

/**
 * 规范化技能命令名称
 *
 * 转换为小写，非字母数字字符替换为连字符。
 */
function sanitizeSkillCommandName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}
