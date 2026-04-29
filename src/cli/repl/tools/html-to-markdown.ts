/**
 * HTML → Markdown 转换模块
 *
 * 使用 turndown 库进行转换，附带启发式正文提取。
 *
 * 参考实现: Claude Code WebFetchTool (turndown 封装模式)
 *
 * @module cli/repl/tools/html-to-markdown
 */

import TurndownService from 'turndown';

// ============ turndown 单例 ============

let turndownInstance: TurndownService | null = null;

/**
 * 获取 turndown 实例（懒加载单例）
 */
function getTurndown(): TurndownService {
  if (!turndownInstance) {
    turndownInstance = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      linkStyle: 'inlined',
    });
  }
  return turndownInstance;
}

// ============ 正文提取 ============

/** 正文提取候选选择器（按优先级排序） */
const MAIN_CONTENT_SELECTORS = [
  'main',
  'article',
  '[role="main"]',
  '.content',
  '.article',
  '.post',
  '.entry',
  '#content',
  '#article',
  '#post',
  '#main',
];

/**
 * 从 HTML 中启发式提取正文内容
 */
export function extractMainContent(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.trim() ?? '';

  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i);
  const description = descMatch?.[1]?.trim() ?? '';

  for (const selector of MAIN_CONTENT_SELECTORS) {
    const content = extractBySelector(html, selector);
    if (content != null && content.length > 100) {
      return buildOutput(title, description, content);
    }
  }

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyContent = bodyMatch?.[1] ?? html;

  return buildOutput(title, description, bodyContent);
}

/**
 * 用正则从 HTML 中提取匹配选择器的元素内容
 */
function extractBySelector(html: string, selector: string): string | null {
  if (selector.startsWith('#')) {
    const id = selector.slice(1);
    const regex = new RegExp(
      `<[^>]+id=["']${escapeRegex(id)}["'][^>]*>([\\s\\S]*?)</\\s*\\1>`,
      'i'
    );
    const match = html.match(regex);
    return match?.[1] ?? null;
  }

  const tagMatch = selector.match(/^([a-z][\w-]*)$/i);
  if (tagMatch) {
    const regex = new RegExp(
      `<${escapeRegex(selector)}[^>]*>([\\s\\S]*?)<\\/\\s*${escapeRegex(selector)}>`,
      'i'
    );
    const match = html.match(regex);
    return match?.[1] ?? null;
  }

  const classMatch = selector.match(/^\.([\w-]+)$/);
  if (classMatch?.[1]) {
    const cls = classMatch[1];
    const regex = new RegExp(
      `<[^>]+class=["'][^"']*${escapeRegex(cls)}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`,
      'i'
    );
    const match = html.match(regex);
    return match?.[1] ?? null;
  }

  const roleMatch = selector.match(/^\[role=["'](\w+)["']\]$/);
  if (roleMatch?.[1]) {
    const role = roleMatch[1];
    const regex = new RegExp(
      `<[^>]+role=["']${escapeRegex(role)}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`,
      'i'
    );
    const match = html.match(regex);
    return match?.[1] ?? null;
  }

  return null;
}

/** 转义正则特殊字符 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 组装最终输出
 */
function buildOutput(title: string, description: string, content: string): string {
  let result = '';
  if (title) {
    result += `# ${title}\n\n`;
  }
  if (description) {
    result += `> ${description}\n\n`;
  }
  result += content;
  return result;
}

// ============ 公开 API ============

/**
 * 将 HTML 转换为 Markdown
 */
export function htmlToMarkdown(html: string): string {
  return getTurndown().turndown(html);
}

/**
 * 提取正文并转换为 Markdown
 */
export function extractAndConvert(html: string): string {
  const extracted = extractMainContent(html);
  return htmlToMarkdown(extracted);
}
