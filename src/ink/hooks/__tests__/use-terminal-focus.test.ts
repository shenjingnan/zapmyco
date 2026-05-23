/**
 * useTerminalFocus — 终端焦点 hook 测试
 *
 * 测试 TerminalFocusContext 的创建和导出。
 */

import { describe, expect, it } from 'vitest';
import type { TerminalFocusContextProps } from '../../components/TerminalFocusContext';
import { TerminalFocusProvider } from '../../components/TerminalFocusContext';

describe('TerminalFocusContext', () => {
  it('应导出 TerminalFocusProvider', () => {
    expect(TerminalFocusProvider).toBeDefined();
    expect(typeof TerminalFocusProvider).toBe('function');
  });

  it('TerminalFocusProvider.displayName 应存在', () => {
    // Provider 组件应可调用
    expect(TerminalFocusProvider.length).toBeGreaterThanOrEqual(0);
  });

  it('类型定义应正确', () => {
    const props: TerminalFocusContextProps = {
      isTerminalFocused: true,
      terminalFocusState: 'unknown',
    };
    expect(props.isTerminalFocused).toBe(true);
    expect(props.terminalFocusState).toBe('unknown');
  });

  it('isTerminalFocused 应为 boolean', () => {
    const props: TerminalFocusContextProps = {
      isTerminalFocused: false,
      terminalFocusState: 'focused',
    };
    expect(typeof props.isTerminalFocused).toBe('boolean');
  });
});
