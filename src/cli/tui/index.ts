/**
 * TUI 模块入口
 *
 * 保留向后兼容导出。新代码应使用 Ink (@/ink) API。
 * @deprecated 优先使用 @/ink 中的等价功能
 */

export { RESET_SCROLL_REGION, scrollDown, scrollUp } from '@/ink/termio/csi';
// === DEC 序列管理 — 现在从 Ink 的 termio/ 重导出 ===
export {
  BSU,
  DEC,
  decreset,
  decset,
  ENTER_ALT_SCREEN,
  ESU,
  EXIT_ALT_SCREEN,
  HIDE_CURSOR,
  SHOW_CURSOR,
} from '@/ink/termio/dec';
export type { AutocompleteProvider, Completion } from './autocomplete';
// === 本地自动补全 ===
export { CombinedAutocompleteProvider } from './autocomplete';
// === 剪贴板管理 ===
export { setClipboard } from './clipboard';
// === 本地引擎实现（待移除）===
export { Container } from './container';

/**
 * setScrollRegion — 从旧 dec.ts 保留的实现
 * 等 CSI 序列，在 termio/csi.ts 中没有对应参数化版本
 */
export const setScrollRegion = (top: number, bottom: number): string => `\x1b[${top};${bottom}r`;

export type { DiffResult, Patch } from './diff';
// === Diff 引擎 ===
export { diffScreens } from './diff';
// === 本地 TUI 组件（待移除）===
export { Editor } from './editor';
export type { CursorMarker } from './engine';
export { renderAnsiLineToScreen, TUI } from './engine';
export { Input } from './input';
// === 本地键处理 ===
export { Key, matchesKey } from './key';
// === 本地键绑定 ===
export { getKeybindings } from './keybindings';
export type { Cell } from './screen';
// === Screen 缓冲区 ===
export { Screen } from './screen';
export { SelectList } from './select-list';
export type { AnsiCode } from './style-pool';
// === 样式池 ===
export { StylePool } from './style-pool';
export { ProcessTerminal } from './terminal';
// === 本地文本工具（待迁移到 Ink）===
export { truncateToWidth, wrapTextWithAnsi } from './text-utils';
// === 本地类型定义 ===
export type {
  Component,
  EditorOptions,
  EditorTheme,
  OverlayHandle,
  OverlayOptions,
  Rect,
  SelectItem,
  SelectListTheme,
  SgrMouseEvent,
  SlashCommand,
} from './types';
