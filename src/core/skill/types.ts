/**
 * Skill 系统核心类型定义
 *
 * @module core/skill
 */

/** Skill 来源标识 */
export type SkillSource = 'bundled' | 'user' | 'project';

/** Skill 执行上下文模式 */
export type SkillContext = 'inline' | 'fork';

/**
 * Skill frontmatter（YAML 元数据）
 *
 * 定义在 SKILL.md 文件头部的 --- 块中。
 */
export interface SkillFrontmatter {
  /** 技能名称（用作 / 命令 slug，唯一标识） */
  name: string;
  /** 触发匹配的描述（帮助 LLM 理解何时调用） */
  description: string;
  /** 版本号 */
  version?: string;
  /** 是否注册为 / 命令（默认 true） */
  'user-invocable'?: boolean;
  /** 是否禁止模型自动调用（默认 false） */
  'disable-model-invocation'?: boolean;
  /** 执行模式：inline 或 fork（默认 inline） */
  context?: SkillContext;
  /** 技能执行期间自动允许的工具列表 */
  'allowed-tools'?: string[];
  /** 参数提示（如 "[file] [options]"） */
  'argument-hint'?: string;
  /** 环境兼容性 */
  compatibility?: {
    os?: string[];
    commands?: string[];
  };
  /** 需要的工具（需要这些工具已注册才可见） */
  'requires-tools'?: string[];
  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * Skill 完整定义
 *
 * 从 SKILL.md 文件解析得到，包含元数据和正文内容。
 */
export interface Skill {
  /** 技能名称（来自 frontmatter name 或目录名） */
  name: string;
  /** 技能描述 */
  description: string;
  /** SKILL.md 文件绝对路径 */
  filePath: string;
  /** 技能目录绝对路径 */
  baseDir: string;
  /** 技能来源 */
  source: SkillSource;
  /** 解析后的 frontmatter 原始数据 */
  frontmatter: SkillFrontmatter;
  /** SKILL.md 正文内容（frontmatter 之后的部分） */
  body: string;
  /** 是否禁用模型自动调用 */
  disableModelInvocation: boolean;
  /** 是否注册为 / 命令 */
  userInvocable: boolean;
}

/**
 * 解析后的 Skill 条目（含加载状态）
 */
export interface SkillEntry {
  /** 技能定义 */
  skill: Skill;
  /** 加载时间 */
  loadedAt: Date;
  /** 来源目录路径 */
  sourceDir: string;
}

/**
 * Skill 快照（用于系统提示注入）
 *
 * 在会话开始时冻结，避免运行时文件变更影响提示一致性。
 */
export interface SkillSnapshot {
  /** 技能名称列表 */
  names: string[];
  /** 格式化后的提示文本 */
  prompt: string;
  /** 快照创建时间 */
  frozenAt: Date;
  /** 技能数量 */
  count: number;
}

/** Skill 加载配置 */
export interface SkillLoadConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 额外加载目录 */
  extraDirs?: string[] | undefined;
  /** 系统提示中最大技能数（默认 50） */
  maxSkillsInPrompt?: number | undefined;
  /** SKILL.md 文件最大大小（字节，默认 256KB） */
  maxSkillFileBytes?: number | undefined;
  /** 是否自动信任安全技能 */
  autoAllowSafeSkills?: boolean | undefined;
}

/**
 * Skill 配置条目（面向用户的每技能配置）
 */
export interface SkillConfigEntry {
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /** 环境变量注入 */
  env?: Record<string, string>;
}
