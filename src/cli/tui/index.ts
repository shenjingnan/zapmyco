/**
 * TUI 模块入口
 *
 * 全部自建实现，无外部依赖。
 */

export type { AutocompleteProvider, Completion } from './autocomplete';
// === 本地自动补全 ===
export { CombinedAutocompleteProvider } from './autocomplete';
// === 本地引擎实现 ===
export { Container } from './container';
// === DEC 序列管理 ===
export { BSU, DEC, decreset, decset, ENTER_ALT_SCREEN, ESU, EXIT_ALT_SCREEN, HIDE_CURSOR, SHOW_CURSOR } from './dec';
// === 本地 TUI 组件 ===
export { Editor } from './editor';
export { TUI } from './engine';
export { Input } from './input';
// === 本地键处理 ===
export { Key, matchesKey } from './key';
// === 本地键绑定 ===
export { getKeybindings } from './keybindings';
export { SelectList } from './select-list';
export { ProcessTerminal } from './terminal';

// === 本地文本工具 ===
export { truncateToWidth, wrapTextWithAnsi } from './text-utils';
// === 本地类型定义 ===
export type {
  Component,
  EditorOptions,
  EditorTheme,
  OverlayHandle,
  OverlayOptions,
  SelectItem,
  SelectListTheme,
  SlashCommand,
} from './types';
