/**
 * Shell 安全检查模块
 *
 * 多层安全防护：
 * 1. 硬性阻断列表 — 危险命令无条件拒绝
 * 2. 危险命令审批 — 高风险操作需用户确认
 * 3. 环境变量清洗 — 防止敏感信息泄漏
 * 4. 工作目录验证 — 限制操作范围
 *
 * 参考 Hermes (approval.py) 和 Claude Code (bashSecurity.ts) 的设计。
 *
 * @module cli/repl/tools/shell-security
 */

import * as path from 'node:path';
import type { ApprovalRule, BlockRule, SecurityCheckResult } from './shell-types';

// ============ 硬性阻断列表 ============

const BLOCK_RULES: BlockRule[] = [
  // 文件系统毁灭
  {
    name: 'rm-root-recursive',
    pattern:
      /\brm\s+(?:-[a-zA-Z]*r[a-zA-Z]*\s+)*-[a-zA-Z]*f[a-zA-Z]*\s+(?:--no-preserve-root\s+)?\/(?:\s|$)/,
    risk: 'critical',
    reason: '禁止递归强制删除根目录',
  },
  {
    name: 'rm-rf-root-variant',
    pattern:
      /\brm\s+(?:-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+(?:["']?\/["']?)/,
    risk: 'critical',
    reason: '禁止删除根目录',
  },
  // 裸设备写入
  {
    name: 'dd-block-device',
    pattern: /\bdd\s+.*\bof=\/dev\/(?:sd|nvme|hd|xvd|vd|mmcblk)/,
    risk: 'critical',
    reason: '禁止直接写入裸块设备',
  },
  // 系统关机/重启
  {
    name: 'system-shutdown',
    pattern: /\b(?:shutdown|reboot|halt|poweroff|init\s+[06])\b/,
    risk: 'critical',
    reason: '禁止执行系统关机/重启命令',
  },
  // Fork bomb
  {
    name: 'fork-bomb',
    pattern: /:\s*\(\s*\)\s*\{/,
    risk: 'critical',
    reason: '检测到 fork bomb 模式',
  },
  // 格式化命令
  {
    name: 'mkfs',
    pattern: /\bmkfs\.\w+/,
    risk: 'critical',
    reason: '禁止执行格式化命令',
  },
  // chmod 777 /
  {
    name: 'chmod-root',
    pattern: /\bchmod\s+(?:.*\s)?-R\s+777\s+\//,
    risk: 'critical',
    reason: '禁止递归修改根目录权限为 777',
  },
  // 覆盖关键系统文件
  {
    name: 'overwrite-system',
    pattern: /(?:>|>>)\s*\/etc\/(?:passwd|shadow|sudoers|hosts)/,
    risk: 'critical',
    reason: '禁止覆盖关键系统文件',
  },
];

// ============ 危险命令审批规则 ============

const APPROVAL_RULES: ApprovalRule[] = [
  {
    name: 'rm-recursive',
    pattern: /\brm\s+(?:-[a-zA-Z]*r[a-zA-Z]*|-rf?)\b/,
    risk: 'high',
    message: '检测到递归删除操作，请确认要删除的文件/目录。',
  },
  {
    name: 'force-push-main',
    pattern: /\bgit\s+push\s+(?:-[a-zA-Z]*f[a-zA-Z]*|--force)\s+origin\s+(?:main|master)\b/,
    risk: 'high',
    message: '检测到强制推送到 main/master 分支，可能覆盖远程历史。',
  },
  {
    name: 'curl-pipe-shell',
    pattern: /\b(?:curl|wget)\s+.*\|\s*(?:sh|bash|zsh|python|ruby|perl)\b/,
    risk: 'high',
    message: '检测到从网络下载并直接执行脚本，请确认来源可信。',
  },
  {
    name: 'eval-exec',
    pattern: /\beval\s+/,
    risk: 'medium',
    message: '检测到 eval 命令，可能执行动态内容。',
  },
  {
    name: 'source-exec',
    pattern: /\bsource\s+/,
    risk: 'medium',
    message: '检测到 source 命令执行文件。',
  },
  {
    name: 'sudo',
    pattern: /\bsudo\b/,
    risk: 'medium',
    message: '检测到 sudo 提权操作。',
  },
  {
    name: 'chmod-system',
    pattern: /\bchmod\s+.*\/(?:etc|usr|bin|sbin|opt|var|home)\b/,
    risk: 'medium',
    message: '检测到修改系统目录权限。',
  },
  {
    name: 'chown-recursive',
    pattern: /\bchown\s+(?:-[a-zA-Z]*R[a-zA-Z]*\s+)/,
    risk: 'medium',
    message: '检测到递归修改文件所有者。',
  },
];

// ============ 环境变量阻断键 ============

const BLOCKED_ENV_KEYS = new Set([
  // CI/CD
  'CI_JOB_TOKEN',
  'CI_BUILD_TOKEN',
  'GITLAB_TOKEN',
  'CIRCLECI_TOKEN',
  'TRAVIS_TOKEN',
  // 容器
  'DOCKER_PASSWORD',
  'DOCKER_AUTH',
  // 包管理
  'NPM_TOKEN',
  'NPM_AUTH_TOKEN',
  'NODE_AUTH_TOKEN',
  // LLM
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'COHERE_API_KEY',
  'GOOGLE_AI_API_KEY',
  'MISTRAL_API_KEY',
  'DEEPSEEK_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'HUGGINGFACE_TOKEN',
  'REPLICATE_API_KEY',
  // 数据库
  'DATABASE_URL',
  'DB_PASSWORD',
  'PGPASSWORD',
  'MYSQL_PWD',
  'REDIS_URL',
  'MONGO_URL',
  'ELASTIC_URL',
  // 安全
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'PRIVATE_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  // 代码注入风险
  'LD_PRELOAD',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'LD_LIBRARY_PATH',
  'BASH_FUNC_',
  'NODE_OPTIONS',
  'PYTHONPATH',
  'PERL5LIB',
  'RUBYLIB',
  'CLASSPATH',
]);

const BLOCKED_ENV_KEY_PREFIXES = ['AWS_SECRET_', 'AZURE_CLIENT_SECRET_', 'GCP_SECRET_'];

// ============ 安全目录约束 ============

const FORBIDDEN_WORKDIR_PREFIXES = ['/etc', '/root', '/home'];

// ============ 公开 API ============

/**
 * 检查命令安全性（阻断检查 + 审批检查）
 */
export function checkCommandSecurity(command: string): SecurityCheckResult {
  // 移除 ANSI 转义序列
  const cleaned = stripAnsi(command);
  // 规范化空白
  const normalized = cleaned.replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return { allowed: false, blocked: true, reason: '命令为空' };
  }

  // Step 1: 硬性阻断检查
  for (const rule of BLOCK_RULES) {
    if (rule.pattern.test(normalized)) {
      return {
        allowed: false,
        blocked: true,
        risk: rule.risk,
        reason: rule.reason,
        matchedRule: rule.name,
      };
    }
  }

  // Step 2: 危险命令审批检查
  for (const rule of APPROVAL_RULES) {
    if (rule.pattern.test(normalized)) {
      return {
        allowed: true,
        requiresApproval: true,
        risk: rule.risk,
        reason: rule.message,
        matchedRule: rule.name,
      };
    }
  }

  return { allowed: true };
}

/**
 * 清洗环境变量（返回安全的子进程环境）
 */
export function sanitizeEnv(customEnv?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};

  // 继承当前进程环境
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;

    // 阻断特定的敏感键
    if (BLOCKED_ENV_KEYS.has(key.toUpperCase())) continue;

    // 阻断特定前缀
    if (BLOCKED_ENV_KEY_PREFIXES.some((prefix) => key.toUpperCase().startsWith(prefix))) continue;

    env[key] = value;
  }

  // 合并自定义 env（同样需要过滤）
  if (customEnv) {
    for (const [key, value] of Object.entries(customEnv)) {
      if (BLOCKED_ENV_KEYS.has(key.toUpperCase())) continue;
      if (BLOCKED_ENV_KEY_PREFIXES.some((prefix) => key.toUpperCase().startsWith(prefix))) continue;
      env[key] = value;
    }
  }

  return env;
}

/**
 * 验证工作目录安全性
 */
export function validateWorkdir(workdir?: string): {
  valid: boolean;
  reason?: string;
  resolved: string;
} {
  const resolved = workdir ? path.resolve(workdir) : process.cwd();

  // 检查禁止的目录前缀
  for (const prefix of FORBIDDEN_WORKDIR_PREFIXES) {
    if (resolved === prefix || resolved.startsWith(prefix + path.sep)) {
      return {
        valid: false,
        reason: `不允许在 ${prefix} 目录下执行命令`,
        resolved,
      };
    }
  }

  return { valid: true, resolved };
}

/**
 * 剥离 ANSI 转义序列（ECMA-48 CSI 序列）
 */
export function stripAnsi(text: string): string {
  // 使用 String.fromCharCode 避免 lint noControlCharactersInRegex 报错
  const esc = String.fromCharCode(27);
  const bel = String.fromCharCode(7);

  // eslint-disable-next-line no-control-regex
  const patterns: RegExp[] = [
    // CSI 序列: ESC [ ... m/a-z/A-Z
    new RegExp(`${esc}\\[[0-9;]*[a-zA-Z]`, 'g'),
    // OSC 序列: ESC ] ... BEL 或 ST
    new RegExp(`${esc}\\][0-9;]*[^${bel}]*(${bel}|$)`, 'g'),
    // DCS/PM/APC/SOS: ESC P/X/^/_ ... ESC \
    new RegExp(`${esc}[PX^_][^${esc}]*${esc}\\\\`, 'g'),
    // 屏幕模式: ESC [ ? ... h/l
    new RegExp(`${esc}\\[[?]?[0-9;]*[hl]`, 'g'),
    // 单字符: ESC => 等
    new RegExp(`${esc}[=>]`, 'g'),
    // 其他 C1 控制
    new RegExp(`${esc}[\\x40-\\x5f]`, 'g'),
  ];

  let result = text;
  for (const pattern of patterns) {
    result = result.replace(pattern, '');
  }
  return result;
}

/**
 * 截断输出（头 40% + 尾 60%）
 */
export function truncateOutput(text: string, maxChars: number = 100_000): string {
  if (text.length <= maxChars) return text;

  const headChars = Math.floor(maxChars * 0.4);
  const tailChars = Math.floor(maxChars * 0.6);
  const head = text.slice(0, headChars);
  const tail = text.slice(-tailChars);

  const truncatedHead = text.length - headChars - tailChars;
  const separator = `\n\n... [已截断 ${truncatedHead} 个字符] ...\n\n`;

  return head + separator + tail;
}

/**
 * 脱敏输出中的敏感信息
 */
export function redactSensitiveInfo(text: string): string {
  let result = text;

  // OpenAI API Key
  result = result.replace(/sk-[a-zA-Z0-9_-]{20,}/g, 'sk-***');
  // GitHub Token
  result = result.replace(/ghp_[a-zA-Z0-9]{20,}/g, 'ghp_***');
  // AWS Access Key (必须在 generic pattern 之前)
  result = result.replace(/AKIA[0-9A-Z]{16}/g, 'AKIA***');
  // JWT
  result = result.replace(/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '<JWT-TOKEN>');
  // Generic API Key patterns
  result = result.replace(/([a-zA-Z0-9_-]{15,}=)([a-zA-Z0-9+/]{20,})/g, '$1***');
  // Private key headers
  result = result.replace(
    /-----BEGIN (?:RSA|EC|DSA|OPENSSH) PRIVATE KEY-----[\s\S]*?-----END (?:RSA|EC|DSA|OPENSSH) PRIVATE KEY-----/g,
    '<PRIVATE-KEY>'
  );

  return result;
}
