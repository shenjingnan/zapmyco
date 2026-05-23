/**
 * Ink 版对话框组件
 *
 * 提供 SelectList、TextInput 和 ConfigView 三种对话框。
 * 使用 React/Ink 组件渲染，通过 InkApp 的状态驱动显示。
 *
 * 用法：
 * ```tsx
 * const { dialog, showSelectList } = useDialog();
 *
 * // 在 InkApp 中使用
 * {dialog?.type === 'select' && (
 *   <InkSelectList {...dialog.props} />
 * )}
 * ```
 */

import { useCallback, useState } from 'react';
import type { SelectItem } from '@/cli/tui/types';
import { Box, type Key, Text, useInput } from '@/ink';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DialogState {
  type: 'select' | 'text-input' | 'config-view';
  // biome-ignore lint/suspicious/noExplicitAny: DialogState resolve needs any to support SelectItem and string
  resolve: (value: any) => void;
  props: Record<string, unknown>;
}

export interface DialogApi {
  dialog: DialogState | null;
  showSelectList: (
    items: SelectItem[],
    options?: { maxVisible?: number; title?: string }
  ) => Promise<SelectItem | null>;
  showTextInput: (
    label: string,
    initialValue?: string,
    placeholder?: string
  ) => Promise<string | null>;
}

// ---------------------------------------------------------------------------
// useDialog hook
// ---------------------------------------------------------------------------

/**
 * useDialog — 对话框状态管理 hook。
 *
 * 提供 showSelectList / showTextInput 方法，返回 Promise。
 * 对话框组件通过 dialog state 渲染。
 *
 * @example
 * const { dialog, showSelectList } = useDialog();
 *
 * return (
 *   <Box>
 *     {dialog?.type === 'select' && <InkSelectList {...dialog.props as SelectListProps} />}
 *     <ScrollBox>...</ScrollBox>
 *     <Editor ... />
 *   </Box>
 * );
 */
export function useDialog(): DialogApi {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const showSelectList = useCallback(
    (
      items: SelectItem[],
      options?: { maxVisible?: number; title?: string }
    ): Promise<SelectItem | null> => {
      return new Promise((resolve) => {
        setDialog({
          type: 'select',
          resolve,
          props: { items, maxVisible: options?.maxVisible ?? 10, title: options?.title } as Record<
            string,
            unknown
          >,
        });
      });
    },
    []
  );

  const showTextInput = useCallback(
    (label: string, initialValue?: string, placeholder?: string): Promise<string | null> => {
      return new Promise((resolve) => {
        setDialog({
          type: 'text-input',
          resolve,
          props: {
            label,
            initialValue: initialValue ?? '',
            placeholder: placeholder ?? '',
          } as Record<string, unknown>,
        });
      });
    },
    []
  );

  return { dialog, showSelectList, showTextInput };
}

// ---------------------------------------------------------------------------
// InkSelectList
// ---------------------------------------------------------------------------

export interface SelectListProps {
  items: SelectItem[];
  maxVisible?: number;
  title?: string;
  onSelect: (item: SelectItem | null) => void;
}

export function InkSelectList({
  items,
  maxVisible = 10,
  title,
  onSelect,
}: SelectListProps): React.ReactElement {
  const [filterText, setFilterText] = useState('');
  const [isFiltering, setIsFiltering] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const filteredItems = filterText
    ? items.filter((item) => item.value.toLowerCase().includes(filterText.toLowerCase()))
    : items;

  useInput(
    useCallback(
      (_input: string, key: Key) => {
        if (isFiltering) {
          // 过滤模式
          if (key.escape) {
            setIsFiltering(false);
            setFilterText('');
            return;
          }
          if (key.return) {
            setIsFiltering(false);
            if (filteredItems[selectedIndex]) {
              onSelect(filteredItems[selectedIndex] ?? null);
            }
            return;
          }
          if (key.backspace) {
            setFilterText((prev) => prev.slice(0, -1));
            return;
          }
          // 可见字符
          if (_input.length === 1 && _input >= ' ' && _input <= '~') {
            setFilterText((prev) => prev + _input);
            setSelectedIndex(0);
            setScrollOffset(0);
          }
          return;
        }

        // 正常模式
        if (key.escape || _input === 'q') {
          onSelect(null);
          return;
        }
        if (key.return) {
          if (filteredItems[selectedIndex]) {
            onSelect(filteredItems[selectedIndex] ?? null);
          }
          return;
        }
        if (key.up) {
          setSelectedIndex((prev) => Math.max(0, prev - 1));
          return;
        }
        if (key.down) {
          setSelectedIndex((prev) => Math.min(filteredItems.length - 1, prev + 1));
          return;
        }
        if (key.tab) {
          setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
          return;
        }
        if (_input === '/') {
          setIsFiltering(true);
          setFilterText('');
          return;
        }
      },
      [isFiltering, filteredItems, selectedIndex, onSelect]
    ),
    { isActive: true }
  );

  // Scroll 调整
  if (selectedIndex < scrollOffset) {
    setScrollOffset(selectedIndex);
  }
  if (selectedIndex >= scrollOffset + maxVisible) {
    setScrollOffset(selectedIndex - maxVisible + 1);
  }

  const visibleItems = filteredItems.slice(scrollOffset, scrollOffset + maxVisible);

  return (
    <Box flexDirection="column">
      {title && (
        <Box>
          <Text bold>
            {'  '}
            {title}
          </Text>
        </Box>
      )}

      {isFiltering && (
        <Box>
          <Text color="cyan">
            {'  '}/{filterText}
            {'\u2588'}
          </Text>
        </Box>
      )}

      <Box>
        <Text dim>
          {'  '}
          {'─'.repeat(30)}
        </Text>
      </Box>

      {visibleItems.length > 0 ? (
        visibleItems.map((item, i) => {
          const actualIdx = scrollOffset + i;
          const isSelected = actualIdx === selectedIndex;
          return (
            <Box key={item.value}>
              {isSelected ? (
                <Text color="green" bold>
                  {'  \u276f'} {item.value} {item.description ? `  ${item.description}` : ''}
                </Text>
              ) : (
                <Text>
                  {'   '} {item.value} {item.description ? `  ${item.description}` : ''}
                </Text>
              )}
            </Box>
          );
        })
      ) : (
        <Box>
          <Text color="red"> No matches found</Text>
        </Box>
      )}

      <Box>
        <Text dim>
          {'  '}
          {'─'.repeat(30)}
        </Text>
      </Box>
      <Box>
        <Text dim>
          {'  '}
          {isFiltering
            ? 'Esc 退出搜索 · Enter 确认'
            : '\u2191\u2193 导航 · / 搜索 · Enter 选择 · Esc 取消'}
        </Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// InkTextInput
// ---------------------------------------------------------------------------

export interface TextInputProps {
  label: string;
  initialValue?: string;
  placeholder?: string;
  onSubmit: (value: string | null) => void;
}

export function InkTextInput({
  label,
  initialValue = '',
  placeholder = '',
  onSubmit,
}: TextInputProps): React.ReactElement {
  const [value, setValue] = useState(initialValue);
  const [cursor, setCursor] = useState(initialValue.length);

  useInput(
    useCallback(
      (_input: string, key: Key) => {
        if (key.return) {
          const finalValue = value === placeholder ? initialValue : value;
          onSubmit(finalValue);
          return;
        }
        if (key.escape) {
          onSubmit(null);
          return;
        }
        if (key.backspace) {
          if (cursor > 0) {
            setValue((prev) => prev.slice(0, cursor - 1) + prev.slice(cursor));
            setCursor((c) => c - 1);
          }
          return;
        }
        if (key.left) {
          setCursor((c) => Math.max(0, c - 1));
          return;
        }
        if (key.right) {
          setCursor((c) => Math.min(value.length, c + 1));
          return;
        }
        if (key.home) {
          setCursor(0);
          return;
        }
        if (key.end) {
          setCursor(value.length);
          return;
        }
        if (key.delete) {
          if (cursor < value.length) {
            setValue((prev) => prev.slice(0, cursor) + prev.slice(cursor + 1));
          }
          return;
        }

        // 可见字符
        if (_input.length === 1 && _input >= ' ') {
          setValue((prev) => prev.slice(0, cursor) + _input + prev.slice(cursor));
          setCursor((c) => c + 1);
        }
      },
      [value, cursor, initialValue, placeholder, onSubmit]
    ),
    { isActive: true }
  );

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>
          {'  '}
          {label}
        </Text>
      </Box>
      <Box height={1} />
      <Box>
        <Text dim>
          {'  '}
          {'─'.repeat(30)}
        </Text>
      </Box>
      <Box>
        <Text>
          {'  '}
          {value.slice(0, cursor)}
          {'\u2588'}
          {value.slice(cursor)}
        </Text>
      </Box>
      <Box>
        <Text dim>
          {'  '}
          {'─'.repeat(30)}
        </Text>
      </Box>
      <Box height={1} />
      <Box>
        <Text dim>{'  '}Enter 确认 · Esc 取消</Text>
      </Box>
    </Box>
  );
}
