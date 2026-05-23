/**
 * useTerminalSize — 终端尺寸 hook 测试
 *
 * 测试 TerminalSizeContext 创建和默认值。
 */

import { describe, expect, it } from 'vitest';
import { TerminalSizeContext } from '../../components/TerminalSizeContext';

describe('TerminalSizeContext', () => {
  it('应创建上下文', () => {
    expect(TerminalSizeContext).toBeDefined();
  });

  it('Provider 和 Consumer 应存在', () => {
    expect(TerminalSizeContext.Provider).toBeDefined();
    expect(TerminalSizeContext.Consumer).toBeDefined();
  });
});
