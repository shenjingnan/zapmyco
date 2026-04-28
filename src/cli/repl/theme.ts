/**
 * pi-tui 主题配置
 *
 * 定义 zapmyco TUI 的颜色方案和组件样式。
 * 风格：灰色边框 + 简洁配色，与原有 CLI 风格保持一致。
 */

import type { EditorTheme, SelectListTheme } from '@mariozechner/pi-tui';
import chalk, { Chalk } from 'chalk';

/** 根据颜色开关获取 chalk 实例 */
function makeColor(colorEnabled: boolean): typeof chalk {
  return colorEnabled ? chalk : (new Chalk({ level: 0 }) as unknown as typeof chalk);
}

/**
 * 创建 zapmyco pi-tui 主题
 */
export function createTheme(colorEnabled: boolean) {
  const c = makeColor(colorEnabled);

  /** 基础 selectList 主题 */
  const baseSelectListTheme: SelectListTheme = {
    selectedPrefix: (text: string) => c.cyan(text),
    selectedText: (text: string) => c.bold(c.cyan(text)),
    description: (text: string) => c.gray(text),
    scrollInfo: (text: string) => c.gray(text),
    noMatch: (text: string) => c.gray(text),
  };

  /** Editor 主题：灰色边框，匹配原有的 ─ 分隔线风格 */
  const editorTheme: EditorTheme = {
    borderColor: (text: string) => c.gray(text),
    selectList: baseSelectListTheme,
  };

  return {
    /** 主文本色 */
    text: (s: string) => s,

    /** 加粗 */
    bold: (s: string) => c.bold(s),

    /** 灰色/弱化文本 */
    dim: (s: string) => c.gray(s),

    /** 强调色 - 青色 */
    accent: (s: string) => c.cyan(s),

    /** 成功 - 绿色 */
    success: (s: string) => c.green(s),

    /** 错误 - 红色 */
    error: (s: string) => c.red(s),

    /** 警告 - 黄色 */
    warning: (s: string) => c.yellow(s),

    /** 边框色 - 灰色 */
    border: (s: string) => c.gray(s),

    /** Header 文本 */
    heading: (s: string) => c.bold(s),

    editorTheme,
    selectListTheme: baseSelectListTheme,
  };
}

export type ZapmycoTheme = ReturnType<typeof createTheme>;
