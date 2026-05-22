/** 最小渲染间隔（16ms ≈ 60fps） */
export const MIN_RENDER_INTERVAL_MS = 16;

/** 终端尺寸默认值 */
export const DEFAULT_TERMINAL_WIDTH = 80;
export const DEFAULT_TERMINAL_HEIGHT = 24;

/** Ink 元素类型名 */
export const ELEMENT_ROOT = 'ink-root' as const;
export const ELEMENT_BOX = 'ink-box' as const;
export const ELEMENT_TEXT = 'ink-text' as const;
export const ELEMENT_VIRTUAL_TEXT = 'ink-virtual-text' as const;
export const TEXT_NODE = '#text' as const;
