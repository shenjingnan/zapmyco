/**
 * InkZapmycoEditor — Ink 版 ZapmycoEditor 组件
 *
 * 基于 useInput + Box + Text 实现的多行编辑器。
 * 替代旧版通过 prototype override 扩展 Editor 的方式。
 *
 * 功能：
 * - 多行文本编辑与光标导航
 * - 快捷键（Ctrl+C/D/G/B/T, PageUp/Down, Ctrl+Home/End）
 * - 自动补全弹出（/ @ # 触发）
 * - 执行中 loading spinner
 * - 审批模式（通过 ref 暴露 enterApprovalMode/exitApprovalMode）
 */

import {
  forwardRef,
  type ReactElement,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { HistoryStore } from '@/cli/repl/types';
import { Box, type Key, Text, useAnimationFrame, useInput } from '@/ink';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const PROMPT_PREFIX = '\u276f ';

export const LOADING_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface ApprovalOption {
  key: string;
  label: string;
  action: () => void;
}

// ---------------------------------------------------------------------------
// Ref API
// ---------------------------------------------------------------------------

export interface InkZapmycoEditorHandle {
  /** 获取编辑器当前文本 */
  getText: () => string;
  /** 设置编辑器文本 */
  setText: (text: string) => void;
  /** 获取展开后的文本（用于外部编辑器） */
  getExpandedText: () => string;
  /** 添加到历史 */
  addToHistory: (entry: string) => void;
  /** 进入审批模式 */
  enterApprovalMode: (title: string, options: ApprovalOption[]) => void;
  /** 退出审批模式 */
  exitApprovalMode: () => void;
  /** 是否处于审批模式 */
  inApprovalMode: () => boolean;
  /** 设置执行状态 */
  setExecuting: (executing: boolean, showSpinner?: boolean) => void;
  /** 获取是否正在执行 */
  getExecuting: () => boolean;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface InkZapmycoEditorProps {
  /** 自动补全提供者 */
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

  /** 历史记录存储 */
  history?: HistoryStore;

  // === 回调 ===
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
}

// ==================== 内部类型 ====================

interface ApprovalState {
  title: string;
  options: ApprovalOption[];
  selectedIndex: number;
}

// ==================== InkZapmycoEditor ====================

export const InkZapmycoEditor = forwardRef<InkZapmycoEditorHandle, InkZapmycoEditorProps>(
  function InkZapmycoEditor(
    {
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
    }: InkZapmycoEditorProps,
    ref
  ): ReactElement {
    // ==================== 核心状态 ====================
    const bufferRef = useRef<string[]>(['']);
    const [buffer, setBuffer] = useState<string[]>(['']);
    const [cursorRow, setCursorRow] = useState(0);
    const [cursorCol, setCursorCol] = useState(0);
    const [executing, setExecuting] = useState(false);
    const [showSpinner, setShowSpinner] = useState(true);
    const [loadingFrame, setLoadingFrame] = useState(0);
    const lastLoadingTick = useRef(0);

    // 历史
    const [historyEntries] = useState<string[]>(() => {
      if (history) return history.getAll().map((e) => e.input);
      return [];
    });
    const [historyIndex, setHistoryIndex] = useState(-1);

    // 自动补全
    const [acActive, setAcActive] = useState(false);
    const [acItems, setAcItems] = useState<
      Array<{ label: string; value?: string; description?: string }>
    >([]);
    const [acPrefix, setAcPrefix] = useState('');
    const [acSelected, setAcSelected] = useState(-1);

    // 审批模式
    const [approvalState, setApprovalState] = useState<ApprovalState | null>(null);

    // 回调 ref（保持变更时稳定）
    const onSubmitRef = useRef(onSubmit);
    onSubmitRef.current = onSubmit;

    // ==================== 动画 ====================

    useAnimationFrame(
      (delta) => {
        lastLoadingTick.current += delta;
        if (lastLoadingTick.current >= 100) {
          lastLoadingTick.current = 0;
          setLoadingFrame((f) => (f + 1) % LOADING_FRAMES.length);
        }
      },
      { enabled: executing && showSpinner }
    );

    // ==================== Ref API ====================

    useImperativeHandle(
      ref,
      () => ({
        getText: () => bufferRef.current.join('\n'),
        setText: (text: string) => {
          const lines = text === '' ? [''] : text.split('\n');
          bufferRef.current = lines;
          setBuffer(lines);
          setCursorRow(lines.length - 1);
          setCursorCol(lines[lines.length - 1]?.length ?? 0);
          setHistoryIndex(-1);
        },
        getExpandedText: () => bufferRef.current.join('\n'),
        addToHistory: (entry: string) => {
          if (history) {
            history.push({ input: entry, timestamp: Date.now() });
          }
        },
        enterApprovalMode: (title: string, options: ApprovalOption[]) => {
          setExecuting(false);
          setShowSpinner(true);
          setApprovalState({ title, options, selectedIndex: 0 });
        },
        exitApprovalMode: () => {
          setApprovalState(null);
        },
        inApprovalMode: () => approvalState !== null,
        setExecuting: (exec: boolean, spinner = true) => {
          setExecuting(exec);
          setShowSpinner(spinner);
          if (!exec) {
            setLoadingFrame(0);
          }
        },
        getExecuting: () => executing,
      }),
      [approvalState, executing, history]
    );

    // ==================== 状态同步 ====================

    // 保持 ref 与 state 同步（供 autocomplete 读取最新值）
    const bufferForRef = buffer;
    bufferRef.current = bufferForRef;

    // ==================== 输入处理 ====================

    /** 审批模式输入 */
    const handleApprovalInput = useCallback((_input: string, key: Key) => {
      setApprovalState((prev) => {
        if (!prev) return prev;

        // Esc / q / Ctrl+C → 最后一个选项（通常为拒绝）
        if (key.escape || _input === 'q') {
          const lastOpt = prev.options[prev.options.length - 1];
          setTimeout(() => lastOpt?.action(), 0);
          return null;
        }

        // ↑ → 上移
        if (key.up) {
          return { ...prev, selectedIndex: Math.max(0, prev.selectedIndex - 1) };
        }

        // ↓ → 下移
        if (key.down) {
          return {
            ...prev,
            selectedIndex: Math.min(prev.options.length - 1, prev.selectedIndex + 1),
          };
        }

        // Tab → 循环
        if (key.tab) {
          return {
            ...prev,
            selectedIndex: (prev.selectedIndex + 1) % prev.options.length,
          };
        }

        // Enter → 确认当前选项
        if (key.return) {
          const opt = prev.options[prev.selectedIndex];
          setTimeout(() => opt?.action(), 0);
          return null;
        }

        // 1-9 → 数字快捷键
        if (_input >= '1' && _input <= '9') {
          const idx = parseInt(_input, 10) - 1;
          const opt = prev.options[idx];
          setTimeout(() => opt?.action(), 0);
          return null;
        }

        return prev;
      });
    }, []);

    useInput(
      // biome-ignore lint/correctness/useExhaustiveDependencies: 通过 useRef 保持稳定引用，避免依赖地狱
      useCallback(
        (input: string, key: Key) => {
          // 审批模式优先
          if (approvalState) {
            handleApprovalInput(input, key);
            return;
          }

          // 执行中禁用编辑输入
          if (executing) return;

          // === Autocomplete 活跃时的特殊处理 ===
          if (acActive && acItems.length > 0) {
            if (key.escape) {
              setAcActive(false);
              setAcItems([]);
              setAcSelected(-1);
              return;
            }
            if (key.up) {
              setAcSelected((prev) => Math.max(0, prev - 1));
              return;
            }
            if (key.down) {
              setAcSelected((prev) => Math.min(acItems.length - 1, prev + 1));
              return;
            }
            if (key.tab || key.return) {
              applyAc();
              return;
            }
          }

          // Escape
          if (key.escape) {
            if (acActive) {
              setAcActive(false);
              setAcItems([]);
              setAcPrefix('');
              setAcSelected(-1);
              return;
            }
            if (onClearSelection) {
              onClearSelection();
              return;
            }
            if (onEscape) {
              onEscape();
              return;
            }
            return;
          }

          // Enter → 提交
          if (key.return) {
            const text = bufferRef.current.join('\n');
            bufferRef.current = [''];
            setBuffer(['']);
            setCursorRow(0);
            setCursorCol(0);
            setHistoryIndex(-1);
            onSubmitRef.current?.(text);
            return;
          }

          // Ctrl+C
          if (key.ctrl && input === '\x03') {
            onCtrlC?.();
            return;
          }

          // Ctrl+D
          if (key.ctrl && input === '\x04') {
            if (bufferRef.current.join('\n').length === 0) {
              onCtrlD?.();
            }
            return;
          }

          // Ctrl+G
          if (key.ctrl && input === '\x07') {
            onOpenEditor?.();
            return;
          }

          // Ctrl+B
          if (key.ctrl && input === '\x02') {
            onRunInBackground?.();
            return;
          }

          // Ctrl+T / Ctrl+Y
          if ((key.ctrl && input === '\x14') || (key.ctrl && input === '\x19')) {
            onToggleThinking?.();
            return;
          }

          // PageUp / PageDown
          if (key.pageUp) {
            onPageUp?.();
            return;
          }
          if (key.pageDown) {
            onPageDown?.();
            return;
          }

          // Ctrl+Home / Ctrl+End
          if (key.home && key.ctrl) {
            onScrollToTop?.();
            return;
          }
          if (key.end && key.ctrl) {
            onScrollToBottom?.();
            return;
          }

          // Backspace
          if (key.backspace) {
            const buf = bufferRef.current;
            const row = cursorRow;
            const col = cursorCol;
            if (col > 0) {
              const line = buf[row] ?? '';
              const next = [...buf];
              next[row] = line.slice(0, col - 1) + line.slice(col);
              bufferRef.current = next;
              setBuffer(next);
              setCursorCol(col - 1);
              // 触发 autocomplete 检查
              const before = next[row]?.slice(0, col - 1) ?? '';
              if (autocompleteProvider && /(?:^|\s)[/@#][^\s]*$/.test(before)) {
                requestAc(false);
              } else {
                setAcActive(false);
              }
            } else if (row > 0) {
              const prevLine = buf[row - 1] ?? '';
              const curLine = buf[row] ?? '';
              const next = [...buf];
              next[row - 1] = prevLine + curLine;
              next.splice(row, 1);
              bufferRef.current = next;
              setBuffer(next);
              setCursorRow(row - 1);
              setCursorCol(prevLine.length);
            }
            return;
          }

          // 方向键
          if (key.up) {
            if (cursorRow === 0 && historyEntries.length > 0 && historyIndex === -1) {
              const newIdx = historyEntries.length - 1;
              setHistoryIndex(newIdx);
              const entry = historyEntries[newIdx];
              if (entry) {
                const lines = entry.split('\n');
                bufferRef.current = lines;
                setBuffer(lines);
                setCursorRow(0);
                setCursorCol(0);
              }
            } else {
              moveCursorUp();
            }
            return;
          }
          if (key.down) {
            if (historyIndex >= 0) {
              const newIdx = historyIndex + 1;
              if (newIdx >= historyEntries.length) {
                setHistoryIndex(-1);
                bufferRef.current = [''];
                setBuffer(['']);
                setCursorRow(0);
                setCursorCol(0);
              } else {
                const entry = historyEntries[newIdx];
                if (entry) {
                  const lines = entry.split('\n');
                  bufferRef.current = lines;
                  setBuffer(lines);
                  setCursorRow(0);
                  setCursorCol(0);
                  setHistoryIndex(newIdx);
                }
              }
            } else {
              moveCursorDown();
            }
            return;
          }
          if (key.left) {
            moveCursorLeft();
            return;
          }
          if (key.right) {
            moveCursorRight();
            return;
          }

          // Home / End（行首/行尾）
          if (key.home && !key.ctrl) {
            setCursorCol(0);
            return;
          }
          if (key.end && !key.ctrl) {
            setCursorCol(bufferRef.current[cursorRow]?.length ?? 0);
            return;
          }

          // Tab → 触发补全
          if (key.tab) {
            if (autocompleteProvider) {
              requestAc(true);
            } else {
              insertTextAtCursor('  ');
            }
            return;
          }

          // 可见字符输入
          if (input.length === 1 && input >= ' ') {
            insertTextAtCursor(input);

            // 触发 autocomplete 检查
            if (autocompleteProvider) {
              const line = bufferRef.current[cursorRow] ?? '';
              const before = line.slice(0, cursorCol + 1);
              if (
                (input === '/' || input === '@' || input === '#') &&
                /(?:^|\s)$/.test(before.slice(0, -1))
              ) {
                requestAc(false);
              } else if (/[a-zA-Z0-9_-]/.test(input) && /(?:^|\s)[/@#][^\s]*$/.test(before)) {
                requestAc(false);
              } else {
                setAcActive(false);
              }
            }
          }
        },
        [
          approvalState,
          executing,
          acActive,
          acItems,
          cursorRow,
          cursorCol,
          historyIndex,
          historyEntries,
          autocompleteProvider,
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
        ]
      ),
      { isActive: true }
    );

    // ==================== 辅助方法 ====================

    const insertTextAtCursor = useCallback(
      (text: string) => {
        const buf = bufferRef.current;
        const row = cursorRow;
        const col = cursorCol;
        const line = buf[row] ?? '';
        const next = [...buf];
        next[row] = line.slice(0, col) + text + line.slice(col);
        bufferRef.current = next;
        setBuffer(next);
        setCursorCol(col + text.length);
      },
      [cursorRow, cursorCol]
    );

    const moveCursorUp = useCallback(() => {
      const row = cursorRow;
      if (row > 0) {
        const prevLen = bufferRef.current[row - 1]?.length ?? 0;
        setCursorRow(row - 1);
        setCursorCol((c) => Math.min(c, prevLen));
      }
    }, [cursorRow]);

    const moveCursorDown = useCallback(() => {
      const buf = bufferRef.current;
      const row = cursorRow;
      if (row < buf.length - 1) {
        const nextLen = buf[row + 1]?.length ?? 0;
        setCursorRow(row + 1);
        setCursorCol((c) => Math.min(c, nextLen));
      }
    }, [cursorRow]);

    const moveCursorLeft = useCallback(() => {
      const col = cursorCol;
      const row = cursorRow;
      if (col > 0) {
        setCursorCol(col - 1);
      } else if (row > 0) {
        const prevLine = bufferRef.current[row - 1] ?? '';
        setCursorRow(row - 1);
        setCursorCol(prevLine.length);
      }
    }, [cursorRow, cursorCol]);

    const moveCursorRight = useCallback(() => {
      const col = cursorCol;
      const row = cursorRow;
      const line = bufferRef.current[row] ?? '';
      if (col < line.length) {
        setCursorCol(col + 1);
      } else if (row < bufferRef.current.length - 1) {
        setCursorRow(row + 1);
        setCursorCol(0);
      }
    }, [cursorRow, cursorCol]);

    // 自动补全
    const requestAc = useCallback(
      (force: boolean) => {
        if (!autocompleteProvider) return;

        const buf = bufferRef.current;
        const row = cursorRow;
        const col = cursorCol;
        const snapshotText = buf.join('\n');

        autocompleteProvider
          .getSuggestions(buf, row, col, { force })
          .then((result) => {
            if (bufferRef.current.join('\n') !== snapshotText) return;

            if (result && Array.isArray(result.items)) {
              if (result.items.length > 0) {
                setAcItems(result.items);
                setAcPrefix(result.prefix ?? '');
                setAcSelected(0);
                setAcActive(true);
              } else {
                setAcItems([]);
                setAcPrefix(result.prefix ?? '');
                setAcSelected(-1);
                setAcActive(true);
              }
            } else {
              setAcActive(false);
            }
          })
          .catch(() => {});
      },
      [autocompleteProvider, cursorRow, cursorCol]
    );

    const applyAc = useCallback(() => {
      if (!autocompleteProvider || acItems.length === 0) return;
      const idx = acSelected >= 0 ? acSelected : 0;
      const item = acItems[idx];
      if (!item) return;

      try {
        const result = autocompleteProvider.applyCompletion(
          bufferRef.current,
          cursorRow,
          cursorCol,
          item,
          acPrefix
        );
        if (result) {
          bufferRef.current = result.lines;
          setBuffer(result.lines);
          setCursorRow(result.cursorLine);
          setCursorCol(result.cursorCol);
        }
      } catch {
        // ignore
      }
      setAcActive(false);
      setAcItems([]);
      setAcPrefix('');
      setAcSelected(-1);
    }, [autocompleteProvider, acItems, acSelected, cursorRow, cursorCol, acPrefix]);

    // ==================== 渲染 ====================

    // 审批模式
    if (approvalState) {
      return <ApprovalPanel state={approvalState} />;
    }

    // 计算显示行（软换行处理）
    const contentWidth = 80;
    const displayLines: string[] = [];
    for (const line of buffer) {
      if (line.length <= contentWidth) {
        displayLines.push(line);
      } else {
        for (let j = 0; j < line.length; j += contentWidth) {
          displayLines.push(line.slice(j, j + contentWidth));
        }
      }
    }

    // 至少 height=1 行
    while (displayLines.length < 1) {
      displayLines.push('');
    }

    // Ink 引擎自动处理光标位置，无需嵌入硬件光标标记

    const promptWidth = [...PROMPT_PREFIX].length;

    return (
      <Box flexDirection="column">
        {/* 编辑区 */}
        {displayLines.slice(0, 6).map((line, i) => {
          const prefix = i === 0 ? PROMPT_PREFIX : ' '.repeat(promptWidth);

          let content = line;
          if (i === 0 && executing && showSpinner) {
            const frame = LOADING_FRAMES[loadingFrame % LOADING_FRAMES.length] ?? '';
            content = `${frame} ${line}`;
          }

          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: 显示行无唯一 ID，且为静态列表
            <Box key={i} height={1}>
              <Text>
                {prefix}
                {content || '\u00a0'}
              </Text>
            </Box>
          );
        })}

        {/* 自动补全列表 */}
        {acActive && (
          <Box flexDirection="column">
            {acItems.length > 0 ? (
              acItems.slice(0, 10).map((item, i) => {
                const isSelected = i === acSelected;
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 补全项无稳定唯一 ID
                  <Box key={i}>
                    {isSelected ? (
                      <Text color="green" bold>
                        {'\u276f'} {item.label ?? item.value ?? ''}
                        {item.description ? `  ${item.description}` : ''}
                      </Text>
                    ) : (
                      <Text>
                        {' '}
                        {item.label ?? item.value ?? ''}
                        {item.description ? `  ${item.description}` : ''}
                      </Text>
                    )}
                  </Box>
                );
              })
            ) : (
              <Box>
                <Text dim> No matching commands</Text>
              </Box>
            )}
          </Box>
        )}
      </Box>
    );
  }
);

// ==================== ApprovalPanel ====================

function ApprovalPanel({ state }: { state: ApprovalState }): ReactElement | null {
  if (!state) return null;

  return (
    <Box flexDirection="column">
      <Box>
        <Text dim>
          {'  '}
          {'─'.repeat(30)}
        </Text>
      </Box>
      <Box>
        <Text bold>
          {'  '}
          {state.title}
        </Text>
      </Box>
      <Box height={1} />
      {state.options.map((opt, i) => {
        const isFocused = state.selectedIndex === i;
        return (
          <Box key={opt.key ?? i}>
            {isFocused ? (
              <Text>
                <Text color="green">
                  {' \u276f'} <Text dim>{opt.key}</Text>
                </Text>
                <Text color="green" bold>
                  {' '}
                  {opt.label}
                </Text>
              </Text>
            ) : (
              <Text>
                {' '}
                <Text dim>{opt.key}</Text> {opt.label}
              </Text>
            )}
          </Box>
        );
      })}
      <Box height={1} />
      <Box>
        <Text dim> Esc 取消 · Tab 切换 · 1/2/3 快捷选择</Text>
      </Box>
    </Box>
  );
}
