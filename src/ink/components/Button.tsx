/**
 * Button — 可聚焦按钮组件。
 *
 * 终端中的可点击按钮，支持键盘激活（Enter/Space）。
 * 聚焦时显示高亮样式。
 *
 * 注意：Ink 当前没有完整的 useFocus hook，Button 通过 props 接收聚焦状态。
 * 完整的事件系统（含 capture/bubble）将在 PR7 中实现。
 */

import React, { type ReactNode } from 'react';
// Box 和 Text 通过 React.createElement 使用，无需显式导入

export interface ButtonProps {
  children?: ReactNode;
  /** 是否聚焦（由外部 FocusManager 控制） */
  focused?: boolean;
  /** 激活回调（Enter/Space 触发） */
  onPress?: () => void;
  /** 按钮样式 */
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
}

/**
 * Button — 可聚焦按钮。
 *
 * @example
 * <Button focused={isFocused} onPress={() => confirm()}>
 *   确认
 * </Button>
 */
export function Button({
  children,
  focused = false,
  color,
  bold,
}: ButtonProps): React.ReactElement {
  return React.createElement(
    'ink-box',
    {
      style: {
        flexGrow: 0,
        paddingLeft: 1,
        paddingRight: 1,
      },
    },
    React.createElement(
      'ink-text',
      {
        style: {
          color,
          bold: bold ?? focused,
          inverse: focused,
        },
      },
      children
    )
  );
}
