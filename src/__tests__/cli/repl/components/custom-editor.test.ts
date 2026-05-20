import { describe, expect, it, vi } from 'vitest';

// Mock pi-tui — 让 ZapmycoEditor 可以正常实例化
vi.mock('@mariozechner/pi-tui', () => ({
  Editor: class MockEditor {
    getText = vi.fn().mockReturnValue('');
    // 注意：handleInput 必须是原型方法而非实例属性
    // 否则会遮蔽 ZapmycoEditor 的 prototype override
    handleInput(_data: string): void {
      // no-op
    }
  },
  Key: {
    escape: '\u001b',
    ctrl: (key: string) => ({ name: key, ctrl: true }),
    ctrlShift: (key: string) => ({ name: key, ctrl: true, shift: true }),
  },
  matchesKey: (data: string, key: unknown) => {
    // 对 escape 键永远返回 false（让测试走常规路径）
    if (key === '\u001b') return false;
    if (key && typeof key === 'object' && 'ctrl' in key) {
      const k = key as { name: string; ctrl: boolean; shift?: boolean };
      // Ctrl+Shift 修饰的键：通过大写字母作为 data 来模拟
      if (k.shift) {
        return data === k.name.toUpperCase();
      }
      // 只对 Ctrl+T / Ctrl+Y / Ctrl+E / Ctrl+B 返回 true（避免 Ctrl+D 等 Handler 截断流程）
      // 同时验证 data 字符与键名一致，避免误匹配
      const ctrlChar = String.fromCharCode(k.name.charCodeAt(0) - 96);
      if (data !== ctrlChar) return false;
      if (k.name === 't' || k.name === 'y' || k.name === 'g' || k.name === 'b') return true;
      return false;
    }
    return false;
  },
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
      expect(editor.onToggleThinking).toBeUndefined();
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

    it('onToggleThinking 初始值应为 undefined', () => {
      const editor = createEditor();
      expect(editor.onToggleThinking).toBeUndefined();
    });

    it('应可设置和读取 onToggleThinking', () => {
      const editor = createEditor();
      const cb = vi.fn();
      editor.onToggleThinking = cb;
      expect(editor.onToggleThinking).toBe(cb);
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

    it('onToggleThinking 未设置时 Ctrl+T/Ctrl+Y 不应抛出', () => {
      const editor = createEditor();
      expect(() => editor.handleInput('\x14')).not.toThrow(); // Ctrl+T
      expect(() => editor.handleInput('\x19')).not.toThrow(); // Ctrl+Y
    });
  });

  describe('handleInput — Ctrl+T / Ctrl+Y', () => {
    it('Ctrl+T 应触发 onToggleThinking', () => {
      const editor = createEditor();
      const toggleFn = vi.fn();
      editor.onToggleThinking = toggleFn;

      editor.handleInput('\x14'); // Ctrl+T

      expect(toggleFn).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Y 应触发 onToggleThinking', () => {
      const editor = createEditor();
      const toggleFn = vi.fn();
      editor.onToggleThinking = toggleFn;

      editor.handleInput('\x19'); // Ctrl+Y

      expect(toggleFn).toHaveBeenCalledTimes(1);
    });

    it('多次 Ctrl+T 应累加调用次数', () => {
      const editor = createEditor();
      const toggleFn = vi.fn();
      editor.onToggleThinking = toggleFn;

      editor.handleInput('\x14');
      editor.handleInput('\x14');
      editor.handleInput('\x14');

      expect(toggleFn).toHaveBeenCalledTimes(3);
    });
  });

  describe('handleInput — Ctrl+G', () => {
    it('Ctrl+G 应触发 onOpenEditor', () => {
      const editor = createEditor();
      const openEditor = vi.fn();
      editor.onOpenEditor = openEditor;

      editor.handleInput('\x07'); // Ctrl+G

      expect(openEditor).toHaveBeenCalledTimes(1);
    });

    it('onOpenEditor 未设置时 Ctrl+G 不应抛出', () => {
      const editor = createEditor();
      expect(() => editor.handleInput('\x07')).not.toThrow();
    });
  });

  describe('handleInput — Ctrl+B', () => {
    it('Ctrl+B 应触发 onRunInBackground', () => {
      const editor = createEditor();
      const runBg = vi.fn();
      editor.onRunInBackground = runBg;

      editor.handleInput('\x02'); // Ctrl+B

      expect(runBg).toHaveBeenCalledTimes(1);
    });

    it('onRunInBackground 未设置时 Ctrl+B 不应抛出', () => {
      const editor = createEditor();
      expect(() => editor.handleInput('\x02')).not.toThrow();
    });
  });
});
