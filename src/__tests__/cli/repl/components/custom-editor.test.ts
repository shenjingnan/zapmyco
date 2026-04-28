import { describe, expect, it, vi } from 'vitest';

// Mock pi-tui — 让 ZapmycoEditor 可以正常实例化
vi.mock('@mariozechner/pi-tui', () => ({
  Editor: class MockEditor {
    getText = vi.fn().mockReturnValue('');
    handleInput = vi.fn();
  },
  Key: {
    escape: '\u001b',
    ctrl: (key: string) => ({ name: key, ctrl: true }),
  },
  matchesKey: () => false,
}));

import { ZapmycoEditor } from '@/cli/repl/components/custom-editor';

describe('ZapmycoEditor', () => {
  const createEditor = () => {
    // @ts-expect-error - 测试用，不需要完整 TUI 类型
    return new ZapmycoEditor({ requestRender: vi.fn() }, {});
  };

  describe('类结构', () => {
    it('应能正常实例化', () => {
      expect(() => createEditor()).not.toThrow();
    });

    it('应暴露可选回调属性（默认 undefined）', () => {
      const editor = createEditor();
      expect(editor.onEscape).toBeUndefined();
      expect(editor.onCtrlC).toBeUndefined();
      expect(editor.onCtrlD).toBeUndefined();
    });

    it('应可设置和读取回调', () => {
      const editor = createEditor();
      const cb = vi.fn();

      editor.onEscape = cb;
      expect(editor.onEscape).toBe(cb);

      editor.onCtrlC = cb;
      expect(editor.onCtrlC).toBe(cb);

      editor.onCtrlD = cb;
      expect(editor.onCtrlD).toBe(cb);
    });

    it('应继承 getText 和 handleInput 方法', () => {
      const editor = createEditor();
      expect(typeof editor.getText).toBe('function');
      expect(typeof editor.handleInput).toBe('function');
    });
  });

  describe('handleInput — 安全性', () => {
    it('未设置任何回调时调用不应抛出异常', () => {
      const editor = createEditor();

      // 各种特殊按键都不应报错
      expect(() => editor.handleInput('\u001b')).not.toThrow(); // Escape
      expect(() => editor.handleInput('\x03')).not.toThrow(); // Ctrl+C
      expect(() => editor.handleInput('\x04')).not.toThrow(); // Ctrl+D
      expect(() => editor.handleInput('a')).not.toThrow(); // 普通字符
      expect(() => editor.handleInput('\r')).not.toThrow(); // Enter
    });

    it('设置回调后调用特殊按键不应抛出异常', () => {
      const editor = createEditor();
      editor.onEscape = vi.fn();
      editor.onCtrlC = vi.fn();
      editor.onCtrlD = vi.fn();

      expect(() => editor.handleInput('\u001b')).not.toThrow();
      expect(() => editor.handleInput('\x03')).not.toThrow();
      expect(() => editor.handleInput('\x04')).not.toThrow();
    });
  });
});
