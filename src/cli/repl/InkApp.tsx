/**
 * InkApp — REPL 根 React 组件
 *
 * 使用 Ink Box/Text 组件描述 REPL 布局。
 * PR2: 基础布局骨架，使用桥接 Wrapper 显示旧组件内容。
 *
 * 布局结构：
 * ┌─────────────────────────────┐
 * │       OutputArea             │  ← flexGrow=1
 * ├─────────────────────────────┤
 * │       TaskStatusBar          │  ← height=1
 * ├─────────────────────────────┤
 * │       AgentStatusBar         │  ← height=1
 * ├─────────────────────────────┤
 * │  Editor (with border)       │  ← height=6
 * └─────────────────────────────┘
 */

import type React from 'react';
import { useEffect, useState } from 'react';
import type { AgentStatusBar } from '@/cli/repl/components/agent-status-bar';
import type { ZapmycoEditor } from '@/cli/repl/components/custom-editor';
import type { OutputArea } from '@/cli/repl/components/output-area';
import type { TaskStatusBar } from '@/cli/repl/components/task-status-bar';
import { App } from '@/ink/components/App';
import { Box } from '@/ink/components/Box';
import { Text } from '@/ink/components/Text';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface InkAppProps {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  outputArea: OutputArea;
  editor: ZapmycoEditor;
  agentStatusBar: AgentStatusBar;
  taskStatusBar: TaskStatusBar;
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
  agentStatusBar,
  taskStatusBar,
  onExit,
}: InkAppProps): React.ReactElement {
  return (
    <App stdin={stdin} stdout={stdout} onExit={onExit ?? (() => {})}>
      <Box flexDirection="column" height="100%">
        {/* 输出区域 */}
        <Box flexGrow={1} overflow="scroll">
          <OutputAreaWrapper outputArea={outputArea} />
        </Box>

        {/* 任务状态栏 */}
        <Box height={1}>
          <StatusBarWrapper statusBar={taskStatusBar} />
        </Box>

        {/* Agent 状态栏 */}
        <Box height={1}>
          <StatusBarWrapper statusBar={agentStatusBar} />
        </Box>

        {/* 编辑器（含边框） */}
        <Box height={6}>
          <EditorWrapper editor={editor} />
        </Box>
      </Box>
    </App>
  );
}

// ---------------------------------------------------------------------------
// 桥接 Wrapper 组件
//
// 临时方案：定期调用旧组件的 render() 获取内容并显示。
// 后续 PR（PR3-PR5）将逐步替换为纯 React/Ink 实现。
// ---------------------------------------------------------------------------

function OutputAreaWrapper({ outputArea }: { outputArea: OutputArea }): React.ReactElement {
  const [text, setText] = useState('');

  useEffect(() => {
    const update = () => {
      try {
        const lines = outputArea.render(80);
        setText(lines.slice(-10).join('\n'));
      } catch {
        // ignore
      }
    };

    update();
    const id = setInterval(update, 100);
    return () => clearInterval(id);
  }, [outputArea]);

  return <Text>{text || 'Output Area'}</Text>;
}

function EditorWrapper({ editor }: { editor: ZapmycoEditor }): React.ReactElement {
  const [text, setText] = useState('');

  useEffect(() => {
    const update = () => {
      try {
        const lines = editor.render(80);
        setText(lines.slice(0, 3).join('\n'));
      } catch {
        // ignore
      }
    };

    update();
    const id = setInterval(update, 100);
    return () => clearInterval(id);
  }, [editor]);

  return (
    <Box paddingLeft={1}>
      <Text>{text || '> '}</Text>
    </Box>
  );
}

function StatusBarWrapper({
  statusBar,
}: {
  statusBar: { render: (w: number) => string[] };
}): React.ReactElement {
  const [text, setText] = useState('');

  useEffect(() => {
    const update = () => {
      try {
        const lines = statusBar.render(80);
        setText(lines.join('\n'));
      } catch {
        // ignore
      }
    };

    update();
    const id = setInterval(update, 100);
    return () => clearInterval(id);
  }, [statusBar]);

  return <Text dim>{text || '\u00a0'}</Text>;
}
