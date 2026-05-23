/**
 * InkApp — REPL 根 React 组件
 *
 * 使用 Ink Box/Text 组件描述 REPL 布局。
 * PR5: 替换所有占位组件为真实 Ink 组件。
 *
 * 布局结构：
 * ┌─────────────────────────────┐
 * │   ScrollBox                  │  ← flexGrow=1
 * │   └─ VirtualMessageList      │
 * ├─────────────────────────────┤
 * │       InkTaskStatusBar       │
 * ├─────────────────────────────┤
 * │      InkAgentStatusBar       │
 * ├─────────────────────────────┤
 * │     InkZapmycoEditor         │
 * └─────────────────────────────┘
 */

import { type ReactElement, type RefObject, useState } from 'react';
import { InkAgentStatusBar } from '@/cli/repl/components/agent-status-bar';
import {
  InkZapmycoEditor,
  type InkZapmycoEditorHandle,
  type InkZapmycoEditorProps,
} from '@/cli/repl/components/custom-editor';
import type { OutputArea } from '@/cli/repl/components/output-area';
import { InkTaskStatusBar } from '@/cli/repl/components/task-status-bar';
import { VirtualMessageList } from '@/cli/repl/components/virtual-message-list';
import type { HistoryStore } from '@/cli/repl/types';
import type { TaskStore } from '@/core/task/task-store';
import { App, Box, ScrollBox } from '@/ink';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface InkAppProps {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  outputArea: OutputArea;
  taskStore: TaskStore;
  editorRef: RefObject<InkZapmycoEditorHandle | null>;
  autocompleteProvider?: {
    getSuggestions: (
      buffer: string[],
      cursorRow: number,
      cursorCol: number,
      options?: { signal?: AbortSignal; force?: boolean }
    ) => Promise<{
      items: Array<{ label: string; value?: string; description?: string }>;
      prefix?: string;
    } | null>;
    applyCompletion: (
      buffer: string[],
      cursorRow: number,
      cursorCol: number,
      item: { label: string; value?: string; description?: string },
      prefix: string
    ) => { lines: string[]; cursorLine: number; cursorCol: number } | null;
  };
  history?: HistoryStore;
  /** Editor callbacks */
  onSubmit?: (text: string) => void;
  onEscape?: () => void;
  onClearSelection?: () => void;
  onCtrlC?: () => void;
  onCtrlD?: () => void;
  onOpenEditor?: () => void;
  onRunInBackground?: () => void;
  onToggleThinking?: () => void;
  onPageUp?: () => void;
  onPageDown?: () => void;
  onScrollToTop?: () => void;
  onScrollToBottom?: () => void;
  onExit?: (error?: Error) => void;
  /** 视口尺寸 */
  viewportHeight?: number;
  viewportWidth?: number;
}

// ---------------------------------------------------------------------------
// InkApp
// ---------------------------------------------------------------------------

export function InkApp({
  stdin,
  stdout,
  outputArea,
  taskStore,
  editorRef,
  autocompleteProvider,
  history,
  onSubmit,
  onEscape,
  onClearSelection,
  onCtrlC,
  onCtrlD,
  onOpenEditor,
  onRunInBackground,
  onToggleThinking,
  onPageUp,
  onPageDown,
  onScrollToTop,
  onScrollToBottom,
  onExit,
  viewportHeight = 15,
  viewportWidth = 80,
}: InkAppProps): ReactElement {
  const [scrollTop, setScrollTop] = useState(0);

  const editorProps = {
    autocompleteProvider,
    history,
    onSubmit,
    onEscape,
    onClearSelection,
    onCtrlC,
    onCtrlD,
    onOpenEditor,
    onRunInBackground,
    onToggleThinking,
    onPageUp,
    onPageDown,
    onScrollToTop,
    onScrollToBottom,
  };

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
          <InkTaskStatusBar taskStore={taskStore} />
        </Box>

        {/* Agent 状态栏 */}
        <Box height={1}>
          <InkAgentStatusBar />
        </Box>

        {/* 编辑器 */}
        <Box height={6}>
          <InkZapmycoEditor
            ref={editorRef}
            {...(editorProps as unknown as InkZapmycoEditorProps)}
          />
        </Box>
      </Box>
    </App>
  );
}
