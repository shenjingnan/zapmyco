/**
 * TUI 模块入口
 *
 * 逐步自建 pi-tui 替代的 barrel 导出文件。
 * 当前版本：本地导出类型 + 工具函数，其余 re-export pi-tui。
 *
 * 后续 PR 逐步将 re-export 替换为本地实现。
 */

// === pi-tui re-export（后续 PR 逐步替换） ===
export {
  CombinedAutocompleteProvider,
  Container,
  Editor,
  getKeybindings,
  ProcessTerminal,
  TUI,
} from '@earendil-works/pi-tui';
// === 本地实现（逐步替换 pi-tui） ===
export { Input } from './input';
// === 本地键处理 ===
export { Key, matchesKey } from './key';
export { SelectList } from './select-list';

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
