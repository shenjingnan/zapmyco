/**
 * TUI 类型定义
 *
 * 自建 TUI 组件所需的接口类型。
 */

/** 组件接口 — 所有 TUI 组件必须实现此接口 */
export interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  /** 处理鼠标滚轮滚动事件 */
  handleScroll?(direction: 'up' | 'down', lines?: number): void;
  /** 当前滚动偏移量（0 = 底部），用于引擎层切片 */
  readonly scrollOffset?: number;
  invalidate(): void;
}

/** SizeValue 类型（数字或百分比字符串） */
export type SizeValue = number | `${number}%`;

/** Overlay 锚点位置 */
export type OverlayAnchor =
  | 'center'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top-center'
  | 'bottom-center'
  | 'left-center'
  | 'right-center';

/** Overlay 外边距 */
export interface OverlayMargin {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/** Overlay 句柄 — 控制 overlay 的显示/隐藏 */
export interface OverlayHandle {
  hide(): void;
}

/** Overlay 布局选项 */
export interface OverlayOptions {
  width?: SizeValue;
  minWidth?: number;
  maxHeight?: SizeValue;
  anchor?: OverlayAnchor;
  offsetX?: number;
  offsetY?: number;
  row?: SizeValue;
  col?: SizeValue;
  margin?: OverlayMargin | number;
}

/** 选择列表项 */
export interface SelectItem {
  value: string;
  label: string;
  description?: string;
}

/** 斜杠命令定义 */
export interface SlashCommand {
  name: string;
  description?: string;
  argumentHint?: string;
}

/** SelectList 主题 */
export interface SelectListTheme {
  selectedPrefix: (text: string) => string;
  selectedText: (text: string) => string;
  description: (text: string) => string;
  scrollInfo: (text: string) => string;
  noMatch: (text: string) => string;
}

/** Editor 主题 */
export interface EditorTheme {
  borderColor: (text: string) => string;
  selectList: SelectListTheme;
}

/** Editor 选项（当前预留，后续 PR 扩展） */
export type EditorOptions = Record<string, never>;
