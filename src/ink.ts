/**
 * zapmyco Ink 框架 barrel 导出。
 *
 * 提供 Ink 渲染框架的公开 API。
 * PR2: 从本地 src/ink/ 自定义实现导出。
 */

export type { AppContextValue, AppProps, StdinContextValue } from './ink/components/App';
export { App, AppContext, StdinContext } from './ink/components/App';
export type { BoxProps } from './ink/components/Box';
export { Button, type ButtonProps } from './ink/components/Button';
export { Newline } from './ink/components/Newline';
// Components
export { Spacer } from './ink/components/Spacer';
export type { TextProps } from './ink/components/Text';
export type { Cursor } from './ink/cursor';
export type { DOMElement, TextNode } from './ink/dom';
export { createNode, createTextNode } from './ink/dom';
export type { Key } from './ink/events/input-event';
export type { Focusable, FocusChangeCallback } from './ink/focus';
export { FocusManager } from './ink/focus';
export type { Diff, FlickerReason, Frame, Patch } from './ink/frame';
export { emptyFrame, shouldClearScreen } from './ink/frame';
export { useAnimationFrame } from './ink/hooks/use-animation-frame';
export { useApp } from './ink/hooks/use-app';
export type { InputHandler } from './ink/hooks/use-input';
// Hooks
export { useInput } from './ink/hooks/use-input';
export { useStdin } from './ink/hooks/use-stdin';
export type { InkOptions } from './ink/ink';
export { LogUpdate } from './ink/log-update';
export { optimize } from './ink/optimizer';
export { Output } from './ink/output';
export { renderNodeToOutput } from './ink/render-node-to-output';
export type { RenderOptions } from './ink/renderer';
export { createRenderer } from './ink/renderer';
export { Box, Ink, render, ScrollBox, Text } from './ink/root';
export type { Cell } from './ink/screen';
export { Screen } from './ink/screen';
export type { Styles, TextStyles } from './ink/styles';
export { ProcessTerminal } from './ink/terminal';
