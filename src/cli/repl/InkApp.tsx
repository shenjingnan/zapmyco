/**
 * InkApp — REPL 根 React 组件
 *
 * 使用 Ink Box/Text 组件描述 REPL 布局。
 * PR3: 用 ScrollBox + VirtualMessageList 替换 OutputAreaWrapper 桥接组件。
 *
 * 布局结构：
 * ┌─────────────────────────────┐
 * │   ScrollBox                  │  ← flexGrow=1
 * │   └─ VirtualMessageList      │
 * ├─────────────────────────────┤
 * │       TaskStatusBar          │  ← height=1
 * ├─────────────────────────────┤
 * │       AgentStatusBar         │  ← height=1
 * ├─────────────────────────────┤
 * │  Editor (with border)       │  ← height=6
 * └─────────────────────────────┘
 */

import { type ReactElement, useState } from 'react';
import type { ZapmycoEditor } from '@/cli/repl/components/custom-editor';
import type { OutputArea } from '@/cli/repl/components/output-area';
import { VirtualMessageList } from '@/cli/repl/components/virtual-message-list';
import { App } from '@/ink/components/App';
import { Box } from '@/ink/components/Box';
import { ScrollBox } from '@/ink/components/ScrollBox';
import { Text } from '@/ink/components/Text';

// ---------------------------------------------------------------------------
// 常量（终端尺寸默认值，后续 PR 将通过 TerminalSizeContext 获取）
// ---------------------------------------------------------------------------

/** 输出区域预估高度（终端行数 - 状态栏 - 编辑器） */
const DEFAULT_VIEWPORT_HEIGHT = 15;
/** 终端宽度默认值 */
const DEFAULT_VIEWPORT_WIDTH = 80;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface InkAppProps {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  outputArea: OutputArea;
  editor: ZapmycoEditor;
  /** 视口高度（终端行数），可选，用于虚拟滚动计算 */
  viewportHeight?: number;
  /** 视口宽度（终端列数），可选 */
  viewportWidth?: number;
  onExit?: (error?: Error) => void;
}

// ---------------------------------------------------------------------------
// InkApp
// ---------------------------------------------------------------------------

export function InkApp({
  stdin,
  stdout,
  outputArea,
  editor,
  viewportHeight = DEFAULT_VIEWPORT_HEIGHT,
  viewportWidth = DEFAULT_VIEWPORT_WIDTH,
  onExit,
}: InkAppProps): ReactElement {
  // 滚动状态（受控模式，由 ScrollBox 和 VirtualMessageList 共享）
  const [scrollTop, setScrollTop] = useState(0);

  return (
    <App stdin={stdin} stdout={stdout} onExit={onExit ?? (() => {})}>
      <Box flexDirection="column" height="100%">
        {/* 输出区域 — 虚拟滚动 */}
        <ScrollBox flexGrow={1} scrollTop={scrollTop} onScroll={setScrollTop}>
          <VirtualMessageList
            outputArea={outputArea}
            scrollTop={scrollTop}
            viewportHeight={viewportHeight}
            viewportWidth={viewportWidth}
          />
        </ScrollBox>

        {/* 任务状态栏 */}
        <Box height={1}>
          <TaskStatusBarPlaceholder />
        </Box>

        {/* Agent 状态栏 */}
        <Box height={1}>
          <AgentStatusBarPlaceholder />
        </Box>

        {/* 编辑器（含边框） */}
        <Box height={6}>
          <EditorPlaceholder editor={editor} />
        </Box>
      </Box>
    </App>
  );
}

// ---------------------------------------------------------------------------
// 占位组件
//
// StatusBar 和 Editor 将在 PR5 中迁移为纯 React/Ink 组件。
// 目前这些占位组件保持布局结构完整。
// ---------------------------------------------------------------------------

function EditorPlaceholder(_props: { editor: ZapmycoEditor }): React.ReactElement {
  return (
    <Box paddingLeft={1}>
      <Text>{'> '}</Text>
    </Box>
  );
}

function TaskStatusBarPlaceholder(): React.ReactElement {
  return <Text dim>{'\u00a0'}</Text>;
}

function AgentStatusBarPlaceholder(): React.ReactElement {
  return <Text dim>{'\u00a0'}</Text>;
}
