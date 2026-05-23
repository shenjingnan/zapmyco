/**
 * zapmyco Ink 框架 barrel 导出。
 *
 * 提供 Ink 渲染框架的公开 API。
 * PR2: 从本地 src/ink/ 自定义实现导出。
 * PR8: 新增 hooks、上下文和组件导出。
 */

// PR9: 工具函数
export { clearTerminal, getClearTerminal } from './ink/clearTerminal';
export { AlternateScreen, type AlternateScreenProps } from './ink/components/AlternateScreen';
// Contexts
export type { AppContextValue } from './ink/components/App';
export { App, AppContext, StdinContext } from './ink/components/App';
// Components
export type { BoxProps } from './ink/components/Box';
export { Button, type ButtonProps } from './ink/components/Button';
export { ClockContext, ClockProvider } from './ink/components/ClockContext';
export {
  CursorDeclarationContext,
  CursorDeclarationContextProvider,
} from './ink/components/CursorDeclarationContext';
export { Link, type LinkProps } from './ink/components/Link';
export { Newline } from './ink/components/Newline';
export { NoSelect } from './ink/components/NoSelect';
export { RawAnsi, type RawAnsiProps } from './ink/components/RawAnsi';
export type { ScrollBoxHandle, ScrollBoxProps } from './ink/components/ScrollBox';
export { Spacer } from './ink/components/Spacer';
export type { StdinContextValue } from './ink/components/StdinContext';
export {
  default as TerminalFocusContext,
  TerminalFocusProvider,
} from './ink/components/TerminalFocusContext';
export { type TerminalSize, TerminalSizeContext } from './ink/components/TerminalSizeContext';
export { TerminalWriteContext } from './ink/components/TerminalWriteContext';
export type { TextProps } from './ink/components/Text';
export type { Cursor } from './ink/cursor';
export type { DOMElement, TextNode } from './ink/dom';
export { createNode, createTextNode } from './ink/dom';
export type { Key } from './ink/events/input-event';
export type { Focusable, FocusChangeCallback } from './ink/focus';
export { FocusManager } from './ink/focus';
// Frame / Diff types
export type { Diff, FlickerReason, Frame, Patch } from './ink/frame';
export { emptyFrame, shouldClearScreen } from './ink/frame';
export { getMaxWidth } from './ink/get-max-width';
export { clearNodeCache, hitTest, updateNodeCache } from './ink/hit-test';
// Hooks
export { useAnimationFrame } from './ink/hooks/use-animation-frame';
export { useApp } from './ink/hooks/use-app';
export { useDeclaredCursor } from './ink/hooks/use-declared-cursor';
export type { InputHandler } from './ink/hooks/use-input';
export { useInput } from './ink/hooks/use-input';
export { useAnimationTimer, useInterval } from './ink/hooks/use-interval';
export { useHasSelection, useSelection } from './ink/hooks/use-selection';
export { useStdin } from './ink/hooks/use-stdin';
export { type TabStatusKind, useTabStatus } from './ink/hooks/use-tab-status';
export { useTerminalFocus } from './ink/hooks/use-terminal-focus';
export { useTerminalSize } from './ink/hooks/use-terminal-size';
export { useTerminalTitle } from './ink/hooks/use-terminal-title';
// Ink core types
export type { InkOptions } from './ink/ink';
// Infrastructure
export { default as instances } from './ink/instances';
export { clearLineWidthCache, lineWidth } from './ink/line-width-cache';
// Render engine
export { LogUpdate } from './ink/log-update';
export { measureElement } from './ink/measure-element';
export { measureText } from './ink/measure-text';
export { optimize } from './ink/optimizer';
export { Output } from './ink/output';
export { renderBackground } from './ink/render-background';
export { type BorderStyle, type BorderTextOptions, renderBorder } from './ink/render-border';
export { renderNodeToOutput } from './ink/render-node-to-output';
export { renderToString } from './ink/render-to-string';
export type { RenderOptions } from './ink/renderer';
export { createRenderer } from './ink/renderer';
// Core public API
export { Box, Ink, render, ScrollBox, Text } from './ink/root';
export type { Cell } from './ink/screen';
export { Screen } from './ink/screen';
export { applySearchHighlight } from './ink/searchHighlight';
export {
  type StyledSegment,
  squashTextNodes,
  squashTextNodesToSegments,
} from './ink/squash-text-nodes';
export { stringWidth } from './ink/stringWidth';
export type { Styles, TextStyles } from './ink/styles';
export { supportsHyperlinks } from './ink/supports-hyperlinks';
export { expandTabs } from './ink/tabstops';
export { ProcessTerminal } from './ink/terminal';
export { widestLine } from './ink/widest-line';
export { wrapText } from './ink/wrap-text';
export { wrapAnsi } from './ink/wrapAnsi';
