/**
 * TUI 类型定义
 *
 * 自建 TUI 组件所需的接口类型。
 */

import type { Screen } from './screen';
import type { StylePool } from './style-pool';

/** 组件可见矩形区域 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** SGR 编码的鼠标事件 */
export interface SgrMouseEvent {
  /** SGR button code，包含按钮类型和修饰键标志 */
  btn: number;
  /** 1-based 列号（终端坐标） */
  col: number;
  /** 1-based 行号（终端坐标） */
  row: number;
  /** 事件类型: press=按下, release=释放, drag=拖拽 */
  action: 'press' | 'release' | 'drag';
  /**
   * 按钮类型（从 btn 低 2 位提取）:
   *   0 = 左键, 1 = 中键, 2 = 右键
   */
  button: number;
  /** Shift 键是否按下（btn & 4） */
  shiftKey: boolean;
  /** Meta/Alt 键是否按下（btn & 8） */
  metaKey: boolean;
  /** Ctrl 键是否按下（btn & 16） */
  ctrlKey: boolean;
}

/** 组件接口 — 所有 TUI 组件必须实现此接口 */
export interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  /** 处理鼠标滚轮滚动事件 */
  handleScroll?(direction: 'up' | 'down', lines?: number): void;
  /** 当前滚动偏移量（0 = 底部），用于引擎层切片 */
  readonly scrollOffset?: number;
  invalidate(): void;
  /** 处理 SGR 鼠标事件 */
  handleMouseEvent?(event: SgrMouseEvent): void;

  /**
   * 渲染到 Screen 缓冲区（新接口）。
   *
   * 优先于 render(width) 使用。引擎按布局顺序依次调用各组件
   * 的 renderToScreen，组件将字符和样式写入指定区域的 Screen buffer。
   *
   * @param screen    Screen 缓冲区
   * @param stylePool 样式池（用于 intern 样式）
   * @param rect      组件在屏幕中的位置和尺寸
   */
  renderToScreen?(screen: Screen, stylePool: StylePool, rect: Rect): void;
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
