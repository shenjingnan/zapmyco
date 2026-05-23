/**
 * CursorDeclarationContext — IME/辅助功能光标声明上下文
 *
 * 允许子组件声明终端光标应停放的位置。
 * 主要用于 IME 预编辑文本渲染和屏幕阅读器追踪。
 *
 * 声明包含相对于某个 DOM 节点的坐标。
 * setter 可选的第二个参数允许条件清除（仅当指定节点持有声明时清除）。
 */

import { createContext } from 'react';
import type { DOMElement } from '../dom';

export interface CursorDeclaration {
  /** 声明节点内的显示列（终端单元格宽度） */
  readonly relativeX: number;
  /** 声明节点内的行号 */
  readonly relativeY: number;
  /** 提供 Yoga 布局绝对坐标的 ink-box DOMElement */
  readonly node: DOMElement;
}

/**
 * CursorDeclaration setter。
 *
 * 第二个可选参数使 `null` 成为条件清除：
 * 仅当当前声明节点匹配 `clearIfNode` 时清除声明。
 * 这对于兄弟组件之间的焦点传递很重要——没有节点检查，
 * 新失焦项的清除可能覆盖新聚焦项的设置。
 */
export type CursorDeclarationSetter = (
  declaration: CursorDeclaration | null,
  clearIfNode?: DOMElement | null
) => void;

export const CursorDeclarationContext = createContext<CursorDeclarationSetter>(() => {});

/**
 * CursorDeclarationContextProvider — 光标声明上下文 Provider 组件
 *
 * 提供 CursorDeclaration setter 的默认实现（不做任何操作）。
 * Ink 框架内部会重写此值以实际管理光标位置。
 */
export function CursorDeclarationContextProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  // 默认实现：存储最新声明（实际移动光标需要 Ink class 集成）
  return (
    <CursorDeclarationContext.Provider value={() => {}}>
      {children}
    </CursorDeclarationContext.Provider>
  );
}
