/**
 * Skill 守卫 — 第三方 Skill 威胁扫描
 *
 * 扫描已加载的 Skill 定义，检测潜在的安全威胁：
 * 1. 过多的 allowed-tools 权限
 * 2. body 中的危险命令
 * 3. 可疑 URL
 * 4. requires-tools 与 allowed-tools 不一致
 *
 * @module security/skill-guard
 */

import type { SkillEntry } from '@/core/skill';
import type { SkillGuardResult, SkillGuardRule, SkillThreatLevel } from './types';

/** 每个 Skill 最大允许的工具数（超过则 warning） */
const MAX_ALLOWED_TOOLS = 10;

/** 危险命令模式 */
const SUSPICIOUS_EXEC_PATTERNS = [
  { pattern: /rm\s+-rf\s+\//, desc: '包含 rm -rf / 系统破坏命令' },
  { pattern: /curl\s+.*\|\s*(?:bash|sh|zsh)/, desc: '包含 curl | bash 管道执行' },
  { pattern: />\s*\/dev\/sda/, desc: '包含直接写入块设备操作' },
  { pattern: /chmod\s+777/, desc: '包含 chmod 777 权限过度放开' },
  { pattern: /\beval\b/, desc: '使用 eval 执行动态代码' },
  { pattern: /sudo\b/, desc: '使用 sudo 提权' },
  { pattern: /mkfs\./, desc: '包含格式化文件系统命令' },
  { pattern: /dd\s+if=/, desc: '包含 dd 磁盘操作' },
  { pattern: /:\s*\(\)\s*\{\s*:\|:?\s*&?\s*\};:/, desc: '包含 fork 炸弹' },
];

/** 可疑 URL 模式 */
const SUSPICIOUS_URL_PATTERNS = [
  { pattern: /https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?/, desc: '包含 IP 地址 URL' },
  { pattern: /https?:\/\/[^/\s]+:\d{4,5}/, desc: '包含非标准端口 URL' },
];

/**
 * 内置 Skill 守卫规则
 */
const BUILTIN_RULES: SkillGuardRule[] = [
  {
    id: 'excessive-allowed-tools',
    description: 'allowed-tools 包含通配符或工具数量过多',
    threatLevel: 'warning',
    check(frontmatter) {
      const allowedTools = frontmatter['allowed-tools'] as string[] | undefined;
      if (!allowedTools || allowedTools.length === 0) return null;

      if (allowedTools.includes('*')) {
        return 'allowed-tools 包含通配符 "*"，Skill 可调用任意工具';
      }
      if (allowedTools.length > MAX_ALLOWED_TOOLS) {
        return `allowed-tools 包含 ${allowedTools.length} 个工具（超过 ${MAX_ALLOWED_TOOLS} 个限制）`;
      }
      return null;
    },
  },
  {
    id: 'suspicious-exec',
    description: 'body 中包含危险命令',
    threatLevel: 'danger',
    check(_frontmatter, body) {
      for (const { pattern, desc } of SUSPICIOUS_EXEC_PATTERNS) {
        if (pattern.test(body)) {
          return desc;
        }
      }
      return null;
    },
  },
  {
    id: 'suspicious-urls',
    description: 'body 中包含可疑 URL',
    threatLevel: 'warning',
    check(_frontmatter, body) {
      for (const { pattern, desc } of SUSPICIOUS_URL_PATTERNS) {
        if (pattern.test(body)) {
          return desc;
        }
      }
      return null;
    },
  },
  {
    id: 'requires-tools-mismatch',
    description: 'requires-tools 与 allowed-tools 不一致',
    threatLevel: 'warning',
    check(frontmatter) {
      const requiredTools = frontmatter['requires-tools'] as string[] | undefined;
      const allowedTools = frontmatter['allowed-tools'] as string[] | undefined;

      if (!requiredTools || requiredTools.length === 0) return null;
      if (!allowedTools || allowedTools.length === 0) return null;

      const missing = requiredTools.filter((t) => !allowedTools.includes(t));
      if (missing.length > 0) {
        return `requires-tools 中的工具不在 allowed-tools 中: ${missing.join(', ')}`;
      }
      return null;
    },
  },
];

export class SkillGuard {
  private rules: SkillGuardRule[];

  constructor() {
    this.rules = [...BUILTIN_RULES];
  }

  /**
   * 扫描单个 SkillEntry，返回威胁扫描结果
   */
  scan(entry: SkillEntry): SkillGuardResult {
    const { skill } = entry;
    const frontmatter = skill.frontmatter as unknown as Record<string, unknown>;
    const violations: SkillGuardResult['violations'] = [];
    let maxThreatLevel: SkillThreatLevel = 'safe';

    for (const rule of this.rules) {
      const reason = rule.check(frontmatter, skill.body);
      if (reason) {
        violations.push({
          ruleId: rule.id,
          reason,
          threatLevel: rule.threatLevel,
        });
        // 升级最高威胁等级
        if (threatSeverity(rule.threatLevel) > threatSeverity(maxThreatLevel)) {
          maxThreatLevel = rule.threatLevel;
        }
      }
    }

    return {
      skillName: skill.name,
      skillPath: skill.filePath,
      threatLevel: maxThreatLevel,
      violations,
      passed: violations.length === 0,
    };
  }

  /**
   * 批量扫描所有 Skills
   */
  scanAll(entries: SkillEntry[]): SkillGuardResult[] {
    return entries.map((entry) => this.scan(entry));
  }

  /**
   * 获取威胁统计
   */
  getThreatSummary(results: SkillGuardResult[]): {
    safe: number;
    warning: number;
    danger: number;
    total: number;
  } {
    let safe = 0;
    let warning = 0;
    let danger = 0;

    for (const r of results) {
      switch (r.threatLevel) {
        case 'safe':
          safe++;
          break;
        case 'warning':
          warning++;
          break;
        case 'danger':
          danger++;
          break;
      }
    }

    return { safe, warning, danger, total: results.length };
  }
}

/** 威胁等级转数值（用于比较） */
function threatSeverity(level: SkillThreatLevel): number {
  switch (level) {
    case 'safe':
      return 0;
    case 'warning':
      return 1;
    case 'danger':
      return 2;
  }
}
