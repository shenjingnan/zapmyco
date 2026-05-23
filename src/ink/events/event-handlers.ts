/**
 * 事件处理器类型定义和查找映射表
 *
 * 定义 Ink 组件可以绑定的所有事件处理器 props。
 * Reconciler 使用 EVENT_HANDLER_PROPS 区分事件属性和普通属性。
 */

// ---------------------------------------------------------------------------
// 处理器类型导入（前向引用 — 类型导入不会产生运行时依赖）
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KeyboardEventHandler = (event: any) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FocusEventHandler = (event: any) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClickEventHandler = (event: any) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HoverEventHandler = () => void;

// ---------------------------------------------------------------------------
// 事件处理器 Props 类型
// ---------------------------------------------------------------------------

export type EventHandlerProps = {
  onKeyDown?: KeyboardEventHandler;
  onKeyDownCapture?: KeyboardEventHandler;
  onFocus?: FocusEventHandler;
  onFocusCapture?: FocusEventHandler;
  onBlur?: FocusEventHandler;
  onBlurCapture?: FocusEventHandler;
  onPaste?: KeyboardEventHandler;
  onPasteCapture?: KeyboardEventHandler;
  onResize?: () => void;
  onClick?: ClickEventHandler;
  onMouseEnter?: HoverEventHandler;
  onMouseLeave?: HoverEventHandler;
};

// ---------------------------------------------------------------------------
// 事件类型 → 处理器 prop 名称的反向查找
// ---------------------------------------------------------------------------

export const HANDLER_FOR_EVENT: Record<
  string,
  { bubble?: keyof EventHandlerProps; capture?: keyof EventHandlerProps }
> = {
  keydown: { bubble: 'onKeyDown', capture: 'onKeyDownCapture' },
  focus: { bubble: 'onFocus', capture: 'onFocusCapture' },
  blur: { bubble: 'onBlur', capture: 'onBlurCapture' },
  paste: { bubble: 'onPaste', capture: 'onPasteCapture' },
  resize: { bubble: 'onResize' },
  click: { bubble: 'onClick' },
};

// ---------------------------------------------------------------------------
// Reconciler 检测事件属性的 Set
// ---------------------------------------------------------------------------

export const EVENT_HANDLER_PROPS = new Set<string>([
  'onKeyDown',
  'onKeyDownCapture',
  'onFocus',
  'onFocusCapture',
  'onBlur',
  'onBlurCapture',
  'onPaste',
  'onPasteCapture',
  'onResize',
  'onClick',
  'onMouseEnter',
  'onMouseLeave',
]);
