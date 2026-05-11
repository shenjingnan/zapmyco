/**
 * 密钥脱敏器
 *
 * 检测和脱敏输出中的敏感密钥/令牌。
 * 内置 15+ 常见 API Key 格式的正则模式。
 *
 * @module security/secret-redaction
 */

import type { SecretRedactionConfig } from './types';

/** 内置密钥检测模式 */
const BUILTIN_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  // 1. OpenAI API Key
  { name: 'OpenAI API Key', regex: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  // 2. GitHub Personal Access Token
  { name: 'GitHub Token', regex: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  // 3. GitHub OAuth Token (old format)
  { name: 'GitHub OAuth Token', regex: /gho_[A-Za-z0-9]{20,}/g },
  // 4. GitLab Personal Access Token
  { name: 'GitLab Token', regex: /glpat-[A-Za-z0-9_-]{20,}/g },
  // 5. AWS Access Key ID
  { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/g },
  // 6. AWS Secret Access Key (context-dependent, heuristic)
  {
    name: 'AWS Secret Key',
    regex:
      /(?:aws[_-]?secret[_-]?access[_-]?key|secret[_-]?key)['":\s]*['"=]?([A-Za-z0-9/+=]{40})/gi,
  },
  // 7. JWT Token
  { name: 'JWT Token', regex: /eyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}/g },
  // 8. Slack Bot Token
  { name: 'Slack Bot Token', regex: /xox[baprs]-[0-9A-Za-z-]{10,}/g },
  // 9. Stripe Live Secret Key
  { name: 'Stripe Key', regex: /(?:sk|pk)_(?:live|test)_[0-9a-zA-Z]{24,}/g },
  // 10. Private Key header
  { name: 'Private Key', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  // 11. Connection strings (with credentials)
  {
    name: 'Connection String',
    regex: /(?:mongodb|postgres(?:ql)?|mysql|redis|sqlserver):\/\/[^:]+:[^@\s]+@/gi,
  },
  // 12. Bearer token in Authorization header
  { name: 'Bearer Token', regex: /bearer\s+([A-Za-z0-9\-_.~+/]{20,})/gi },
  // 13. Google API Key
  { name: 'Google API Key', regex: /AIza[0-9A-Za-z_-]{35}/g },
  // 14. HuggingFace Token
  { name: 'HuggingFace Token', regex: /hf_[A-Za-z0-9]{25,}/g },
  // 15. Generic API key assignment (heuristic)
  {
    name: 'Generic API Key',
    regex:
      /(?:api[_-]?key|apikey|api[_-]?secret)['":\s]*['"=:]?\s*['"]?([A-Za-z0-9\-_]{20,})['"]?/gi,
  },
  // 16. Azure / Entra ID token
  { name: 'Azure Token', regex: /eyJ[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{5,}\.[A-Za-z0-9\-_]{5,}/g },
];

const DEFAULT_PLACEHOLDER = '****REDACTED****';

export class SecretRedactor {
  private patterns: Array<{ name: string; regex: RegExp }>;
  private placeholder: string;

  constructor(config?: SecretRedactionConfig) {
    this.placeholder = config?.placeholder ?? DEFAULT_PLACEHOLDER;
    this.patterns = [...BUILTIN_PATTERNS];

    // 添加自定义模式
    if (config?.extraPatterns?.length) {
      for (const pattern of config.extraPatterns) {
        try {
          this.patterns.push({
            name: 'custom',
            regex: new RegExp(pattern, 'g'),
          });
        } catch {
          // 忽略无效的正则表达式
        }
      }
    }
  }

  /**
   * 对文本执行脱敏，返回脱敏后的文本
   */
  redact(text: string): string {
    if (!text) return text;

    let result = text;
    for (const pattern of this.patterns) {
      // 每次替换重置 lastIndex（全局正则的状态问题）
      pattern.regex.lastIndex = 0;
      result = result.replace(pattern.regex, this.placeholder);
    }
    return result;
  }

  /**
   * 检查文本是否包含敏感密钥
   */
  hasSecrets(text: string): boolean {
    if (!text) return false;

    for (const pattern of this.patterns) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(text)) return true;
    }
    return false;
  }

  /**
   * 获取匹配到的密钥类型列表（不返回密钥值本身）
   */
  detectSecrets(text: string): string[] {
    if (!text) return [];

    const detected = new Set<string>();
    for (const pattern of this.patterns) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(text)) {
        detected.add(pattern.name);
      }
    }
    return [...detected];
  }
}
