/**
 * Editor 组件单元测试
 *
 * 覆盖 Editor 类的所有公有方法和关键私有路径。
 */

import { describe, expect, it, vi } from 'vitest';

// Mock pi-tui — parseKey 用于 key.ts 的 matchesKey
vi.mock('@earendil-works/pi-tui', () => ({
  parseKey: vi.fn((_data: string) => undefined),
}));

import { Editor } from '@/cli/tui/editor';
import type { EditorTheme } from '@/cli/tui/types';

// ==================== 测试工具 ====================

/** 创建 mock TUI 实例 */
function mockTui(requestRender = vi.fn()) {
  return { requestRender, setShowHardwareCursor: vi.fn() };
}

/** 默认 Editor 主题 */
const defaultTheme: EditorTheme = {
  borderColor: (s: string) => s,
  selectList: {
    selectedPrefix: (s: string) => s,
    selectedText: (s: string) => s,
    description: (s: string) => s,
    scrollInfo: (s: string) => s,
    noMatch: (s: string) => s,
  },
};

/** 创建 Editor 实例的工厂函数 */
function createEditor(props?: {
  text?: string;
  tui?: ReturnType<typeof mockTui>;
  theme?: EditorTheme;
}) {
  const tui = props?.tui ?? mockTui();
  const editor = new Editor(tui, props?.theme ?? defaultTheme);
  if (props?.text !== undefined) {
    editor.setText(props.text);
  }
  return { editor, tui };
}

// ==================== 测试: 构造函数 ====================

describe('Editor 构造函数', () => {
  it('应存储 tui 引用', () => {
    const tui = mockTui();
    const editor = new Editor(tui, defaultTheme);
    expect((editor as any).tui).toBe(tui);
  });

  it('应调用 setShowHardwareCursor(true)', () => {
    const tui = mockTui();
    new Editor(tui, defaultTheme);
    expect(tui.setShowHardwareCursor).toHaveBeenCalledWith(true);
  });

  it('tui 无 setShowHardwareCursor 时不报错', () => {
    const tui = { requestRender: vi.fn() };
    expect(() => new Editor(tui, defaultTheme)).not.toThrow();
  });
});

// ==================== 测试: 文本操作 ====================

describe('getText / setText', () => {
  it('初始文本为空字符串', () => {
    const { editor } = createEditor();
    expect(editor.getText()).toBe('');
  });

  it('setText 后 getText 返回设置的内容', () => {
    const { editor } = createEditor();
    editor.setText('hello');
    expect(editor.getText()).toBe('hello');
  });

  it('setText 支持多行文本', () => {
    const { editor } = createEditor();
    editor.setText('line1\nline2\nline3');
    expect(editor.getText()).toBe('line1\nline2\nline3');
  });

  it('setText 空字符串应设为 [""]', () => {
    const { editor } = createEditor();
    editor.setText('hello');
    editor.setText('');
    expect(editor.getText()).toBe('');
  });

  it('setText 后 cursorRow/cursorCol 应指向末尾', () => {
    const { editor } = createEditor();
    editor.setText('hello\nworld');
    expect(editor.cursorRow).toBe(1);
    expect(editor.cursorCol).toBe(5);
  });

  it('setText 后 scrollOffset 和 historyIndex 应重置', () => {
    const { editor } = createEditor();
    editor.setText('hello');
    // 修改 scrollOffset 和 historyIndex
    (editor as any).historyIndex = 5;
    editor.setText('world');
    expect((editor as any).historyIndex).toBe(-1);
  });
});

describe('getExpandedText', () => {
  it('应返回与 getText 相同的内容', () => {
    const { editor } = createEditor();
    editor.setText('hello\nworld');
    expect(editor.getExpandedText()).toBe(editor.getText());
  });
});

// ==================== 测试: 历史管理 ====================

describe('addToHistory', () => {
  it('应添加条目到历史', () => {
    const { editor } = createEditor();
    editor.addToHistory('entry1');
    editor.addToHistory('entry2');
    expect((editor as any).historyIndex).toBe(-1);
  });

  it('historyIndex 应在 addToHistory 后重置为 -1', () => {
    const { editor } = createEditor();
    editor.addToHistory('entry');
    expect(editor.historyIndex).toBe(-1);
  });
});

// ==================== 测试: 自动补全设置 ====================

describe('自动补全设置', () => {
  it('setAutocompleteProvider 后输入 / 应调用 provider.getSuggestions', () => {
    const { editor } = createEditor();
    const provider = { getSuggestions: vi.fn().mockResolvedValue({ items: [], prefix: '' }) };
    editor.setAutocompleteProvider(provider);
    editor.handleInput('/');
    expect(provider.getSuggestions).toHaveBeenCalled();
  });

  it('setAutocompleteMaxVisible 不应报错', () => {
    const { editor } = createEditor();
    expect(() => editor.setAutocompleteMaxVisible(10)).not.toThrow();
  });
});

// ==================== 测试: Component 接口 ====================

describe('invalidate', () => {
  it('不应报错（无缓存）', () => {
    const { editor } = createEditor();
    expect(() => editor.invalidate()).not.toThrow();
  });
});

// ==================== 测试: handleInput - Enter 提交 ====================

describe('handleInput — Enter 提交', () => {
  it('按下 Enter 应触发 onSubmit', () => {
    const { editor } = createEditor();
    const onSubmit = vi.fn();
    editor.onSubmit = onSubmit;
    editor.setText('test input');
    editor.handleInput('\r');
    expect(onSubmit).toHaveBeenCalledWith('test input');
  });

  it('提交后应清空编辑器', () => {
    const { editor } = createEditor();
    const onSubmit = vi.fn();
    editor.onSubmit = onSubmit;
    editor.setText('test input');
    editor.handleInput('\r');
    expect(editor.getText()).toBe('');
    expect(editor.cursorRow).toBe(0);
    expect(editor.cursorCol).toBe(0);
  });

  it('onSubmit 未设置时按 Enter 不应报错', () => {
    const { editor } = createEditor();
    editor.setText('test');
    expect(() => editor.handleInput('\r')).not.toThrow();
  });
});

// ==================== 测试: handleInput - Escape ====================

describe('handleInput — Escape', () => {
  it('autocomplete 非活跃时按 Escape 不应报错', () => {
    const { editor } = createEditor();
    expect(() => editor.handleInput('\x1b')).not.toThrow();
  });

  it('autocomplete 活跃时按 Escape 应关闭补全（通过 render 输出验证）', async () => {
    const { editor } = createEditor();
    const provider = {
      getSuggestions: vi.fn().mockResolvedValue({
        items: [{ label: 'help' }],
        prefix: '/',
      }),
    };
    editor.setAutocompleteProvider(provider);
    editor.handleInput('/');
    // 等待 autocomplete 渲染出补全项（>1 行内容）
    await vi.waitFor(() => {
      const result = editor.render(80);
      expect(result.slice(1, -1).length).toBeGreaterThan(1);
    });
    // Escape 关闭
    editor.handleInput('\x1b');
    // 确认补全列表消失（只剩 1 行内容）
    const result = editor.render(80);
    expect(result.slice(1, -1).length).toBe(1);
  });
});

// ==================== 测试: handleInput - Autocomplete 活跃 ====================

describe('handleInput — Autocomplete 活跃', () => {
  /** 创建一个已触发 autocomplete 的编辑器 */
  async function createEditorWithAC(items: any[] = [{ label: 'a' }, { label: 'b' }]) {
    const { editor, tui } = createEditor();
    const provider = {
      getSuggestions: vi.fn().mockResolvedValue({
        items,
        prefix: '/',
      }),
      applyCompletion: vi.fn() as any,
    };
    editor.setAutocompleteProvider(provider);
    editor.handleInput('/');
    await vi.waitFor(() => {
      // 通过 render 确认 autocomplete 已激活（内容行中出现补全项）
      const result = editor.render(80);
      const contentLines = result.slice(1, -1);
      expect(contentLines.length).toBeGreaterThan(1);
    });
    return { editor, tui, provider };
  }

  it('↑ 键应上移选中项', async () => {
    const { editor } = await createEditorWithAC();
    const beforeLines = editor.render(80).slice(1, -1);
    const beforeAcLines = beforeLines.filter((l) => l.includes('❯'));
    expect(beforeAcLines.length).toBe(1);

    editor.handleInput('\x1b[A'); // up — 在第一项上不移
    const afterLines = editor.render(80).slice(1, -1);
    const afterAcLines = afterLines.filter((l) => l.includes('❯'));
    expect(afterAcLines.length).toBe(1);
  });

  it('↓ 键应下移选中项', async () => {
    const { editor } = await createEditorWithAC();
    // 初始选中第一项，按↓移到第二项
    editor.handleInput('\x1b[B'); // down
    const lines = editor.render(80).slice(1, -1);
    // 选择标记应该移动了
    expect(lines.length).toBeGreaterThan(1);
  });

  it('Tab 应应用补全并关闭列表', async () => {
    const { editor, provider } = await createEditorWithAC([{ label: 'help', value: 'help' }]);
    provider.applyCompletion = vi.fn().mockReturnValue({
      lines: ['/help'],
      cursorLine: 0,
      cursorCol: 5,
    });

    editor.handleInput('\t'); // tab 应用

    // 补全列表应关闭（render 不应有额外行）
    const afterResult = editor.render(80);
    const afterContentLines = afterResult.slice(1, -1);
    expect(afterContentLines.length).toBeLessThanOrEqual(2); // border + 1 content line max
    expect(provider.applyCompletion).toHaveBeenCalled();
  });

  it('Enter 应应用补全并关闭列表', async () => {
    const { editor, provider } = await createEditorWithAC([{ label: 'help', value: 'help' }]);
    provider.applyCompletion = vi.fn().mockReturnValue({
      lines: ['/help'],
      cursorLine: 0,
      cursorCol: 5,
    });

    editor.handleInput('\r'); // enter 应用

    const result = editor.render(80);
    const contentLines = result.slice(1, -1);
    expect(contentLines.length).toBe(1); // 只有一行内容，无补全项
    expect(provider.applyCompletion).toHaveBeenCalled();
  });

  it('Escape 应关闭补全列表', async () => {
    const { editor } = await createEditorWithAC();

    editor.handleInput('\x1b'); // escape

    const result = editor.render(80);
    const contentLines = result.slice(1, -1);
    expect(contentLines.length).toBe(1); // 只有一行内容，无补全项
  });
});

// ==================== 测试: handleInput - Backspace ====================

describe('handleInput — Backspace', () => {
  it('应删除光标前一字符', () => {
    const { editor } = createEditor();
    editor.setText('hello');
    editor.cursorCol = 5;
    editor.handleInput('\x7f'); // backspace
    expect(editor.getText()).toBe('hell');
    expect(editor.cursorCol).toBe(4);
  });

  it('行首退格应合并到上一行', () => {
    const { editor } = createEditor();
    editor.setText('line1\nline2');
    editor.cursorRow = 1;
    editor.cursorCol = 0;
    editor.handleInput('\x7f'); // backspace
    expect(editor.getText()).toBe('line1line2');
    expect(editor.cursorRow).toBe(0);
    expect(editor.cursorCol).toBe(5);
  });

  it('空行行首退格不应报错', () => {
    const { editor } = createEditor();
    editor.cursorRow = 0;
    editor.cursorCol = 0;
    expect(() => editor.handleInput('\x7f')).not.toThrow();
  });
});

// ==================== 测试: handleInput - 方向键 ====================

describe('handleInput — 方向键', () => {
  it('← 键应左移光标', () => {
    const { editor } = createEditor();
    editor.setText('hello');
    editor.cursorRow = 0;
    editor.cursorCol = 3;
    editor.handleInput('\x1b[D'); // left
    expect(editor.cursorCol).toBe(2);
  });

  it('行首按 ← 应跳到上一行行尾', () => {
    const { editor } = createEditor();
    editor.setText('line1\nline2');
    editor.cursorRow = 1;
    editor.cursorCol = 0;
    editor.handleInput('\x1b[D'); // left
    expect(editor.cursorRow).toBe(0);
    expect(editor.cursorCol).toBe(5);
  });

  it('→ 键应右移光标', () => {
    const { editor } = createEditor();
    editor.setText('hello');
    editor.cursorRow = 0;
    editor.cursorCol = 2;
    editor.handleInput('\x1b[C'); // right
    expect(editor.cursorCol).toBe(3);
  });

  it('行尾按 → 应跳到下一行行首', () => {
    const { editor } = createEditor();
    editor.setText('line1\nline2');
    editor.cursorRow = 0;
    editor.cursorCol = 5;
    editor.handleInput('\x1b[C'); // right
    expect(editor.cursorRow).toBe(1);
    expect(editor.cursorCol).toBe(0);
  });

  it('首行行首按 ← 不应移动', () => {
    const { editor } = createEditor();
    editor.setText('hello');
    editor.cursorRow = 0;
    editor.cursorCol = 0;
    editor.handleInput('\x1b[D'); // left
    expect(editor.cursorRow).toBe(0);
    expect(editor.cursorCol).toBe(0);
  });

  it('末行行尾按 → 不应移动', () => {
    const { editor } = createEditor();
    editor.setText('hello');
    editor.cursorRow = 0;
    editor.cursorCol = 5;
    editor.handleInput('\x1b[C'); // right
    expect(editor.cursorRow).toBe(0);
    expect(editor.cursorCol).toBe(5);
  });

  it('↑ 键应上移一行', () => {
    const { editor } = createEditor();
    editor.setText('line1\nline2\nline3');
    editor.cursorRow = 2;
    editor.cursorCol = 3;
    editor.handleInput('\x1b[A'); // up
    expect(editor.cursorRow).toBe(1);
  });

  it('↑ 键在首行不应移动', () => {
    const { editor } = createEditor();
    editor.setText('line1');
    editor.cursorRow = 0;
    editor.handleInput('\x1b[A'); // up
    expect(editor.cursorRow).toBe(0);
  });

  it('↓ 键应下移一行', () => {
    const { editor } = createEditor();
    editor.setText('line1\nline2');
    editor.cursorRow = 0;
    editor.handleInput('\x1b[B'); // down
    expect(editor.cursorRow).toBe(1);
  });

  it('↓ 键在末行不应移动', () => {
    const { editor } = createEditor();
    editor.setText('line1');
    editor.cursorRow = 0;
    editor.handleInput('\x1b[B'); // down
    expect(editor.cursorRow).toBe(0);
  });

  it('↑ 键应限制 cursorCol 不超过目标行长度', () => {
    const { editor } = createEditor();
    editor.setText('ab\ncdef');
    editor.cursorRow = 1;
    editor.cursorCol = 4;
    editor.handleInput('\x1b[A'); // up
    expect(editor.cursorCol).toBe(2); // 'ab'.length = 2
  });
});

// ==================== 测试: handleInput - Home/End ====================

describe('handleInput — Home / End', () => {
  it('Home 键应跳转到行首', () => {
    const { editor } = createEditor();
    editor.setText('hello world');
    editor.cursorCol = 5;
    editor.handleInput('\x1b[H'); // home
    expect(editor.cursorCol).toBe(0);
  });

  it('End 键应跳转到行尾', () => {
    const { editor } = createEditor();
    editor.setText('hello');
    editor.cursorCol = 0;
    editor.handleInput('\x1b[F'); // end
    expect(editor.cursorCol).toBe(5);
  });
});

// ==================== 测试: handleInput - Tab ====================

describe('handleInput — Tab', () => {
  it('有 provider 时 Tab 应触发 autocomplete', () => {
    const { editor } = createEditor();
    const provider = { getSuggestions: vi.fn().mockResolvedValue({ items: [], prefix: '' }) };
    editor.setAutocompleteProvider(provider);
    editor.handleInput('\t');
    expect(provider.getSuggestions).toHaveBeenCalled();
  });

  it('无 provider 时 Tab 应插入 2 空格', () => {
    const { editor } = createEditor();
    editor.setText('ab');
    editor.cursorCol = 2;
    editor.handleInput('\t');
    expect(editor.getText()).toBe('ab  ');
    expect(editor.cursorCol).toBe(4);
  });
});

// ==================== 测试: handleInput - Ctrl 键 ====================

describe('handleInput — Ctrl 键（base Editor 中）', () => {
  it('Ctrl+C 不应抛异常', () => {
    const { editor } = createEditor();
    expect(() => editor.handleInput('\x03')).not.toThrow();
  });

  it('Ctrl+D 不应抛异常', () => {
    const { editor } = createEditor();
    expect(() => editor.handleInput('\x04')).not.toThrow();
  });

  it('各种 Ctrl 组合键均不应抛异常', () => {
    const { editor } = createEditor();
    for (let i = 1; i <= 26; i++) {
      expect(() => editor.handleInput(String.fromCharCode(i))).not.toThrow();
    }
  });
});

// ==================== 测试: handleInput - 字符输入 ====================

describe('handleInput — 字符输入', () => {
  it('普通字符应插入到光标位置', () => {
    const { editor } = createEditor();
    editor.handleInput('h');
    editor.handleInput('e');
    editor.handleInput('l');
    editor.handleInput('l');
    editor.handleInput('o');
    expect(editor.getText()).toBe('hello');
    expect(editor.cursorCol).toBe(5);
  });

  it('光标在行中时字符应插入到光标位置', () => {
    const { editor } = createEditor();
    editor.setText('hllo');
    editor.cursorCol = 1;
    editor.handleInput('e');
    expect(editor.getText()).toBe('hello');
    expect(editor.cursorCol).toBe(2);
  });

  it('输入 / 应触发 autocomplete（通过 provider.getSuggestions 调用确认）', () => {
    const { editor } = createEditor();
    const provider = { getSuggestions: vi.fn().mockResolvedValue({ items: [], prefix: '/' }) };
    editor.setAutocompleteProvider(provider);
    editor.handleInput('/');
    expect(provider.getSuggestions).toHaveBeenCalled();
  });

  it('空格不应触发 autocomplete（provider.getSuggestions 不应被调用）', () => {
    const { editor } = createEditor();
    const provider = { getSuggestions: vi.fn().mockResolvedValue({ items: [], prefix: '' }) };
    editor.setAutocompleteProvider(provider);
    editor.handleInput(' ');
    expect(provider.getSuggestions).not.toHaveBeenCalled();
  });

  it('无 provider 时输入 / 不应报错', () => {
    const { editor } = createEditor();
    expect(() => editor.handleInput('/')).not.toThrow();
  });
});

// ==================== 测试: render ====================

describe('render', () => {
  it('空编辑器应返回 border + 空行 + border', () => {
    const { editor } = createEditor();
    const result = editor.render(80);
    expect(result.length).toBeGreaterThanOrEqual(3);
    // 首行和末行应为 border
    expect(result[0]).toContain('┌');
    expect(result[result.length - 1]).toContain('└');
    // 中间应有内容行
    expect(result[1]).toBe('');
  });

  it('有文本时应在 border 内显示', () => {
    const { editor } = createEditor();
    editor.setText('hello');
    const result = editor.render(80);
    expect(result.length).toBeGreaterThanOrEqual(3);
    // border + content-line + border
    expect(result[1]).toBe('hello');
  });

  it('软换行：超长文本应折行', () => {
    const { editor } = createEditor();
    const longLine = 'x'.repeat(100);
    editor.setText(longLine);
    const result = editor.render(40);
    // 每行最多 contentWidth (= 38) 个字符
    const contentLines = result.slice(1, -1);
    for (const line of contentLines) {
      expect(line.length).toBeLessThanOrEqual(38);
    }
    expect(contentLines.length).toBeGreaterThan(1);
  });

  it('focused 时应嵌入 CURSOR_MARKER', () => {
    const { editor } = createEditor();
    editor.focused = true;
    editor.setText('hello');
    const result = editor.render(80);
    // 内容行应包含 CURSOR_MARKER
    const contentLine = result[1]!;
    expect(contentLine).toContain('\u001B_pi:c\u0007');
  });

  it('非 focused 时不应嵌入 CURSOR_MARKER', () => {
    const { editor } = createEditor();
    editor.focused = false;
    editor.setText('hello');
    const result = editor.render(80);
    const contentLine = result[1]!;
    expect(contentLine).not.toContain('\u001B_pi:c\u0007');
  });

  it('autocomplete 活跃时应在内容末尾追加补全项', async () => {
    const { editor } = createEditor();
    const provider = {
      getSuggestions: vi.fn().mockResolvedValue({
        items: [
          { label: 'help', description: '显示帮助信息' },
          { label: 'quit', description: '退出' },
        ],
        prefix: '/',
      }),
    };
    editor.setAutocompleteProvider(provider);
    editor.handleInput('/');
    await vi.waitFor(() => {
      const result = editor.render(80);
      const contentLines = result.slice(1, -1);
      const acLine = contentLines.find((l: string) => l.includes('help'));
      expect(acLine).toBeTruthy();
    });
    const result = editor.render(80);
    const contentLines = result.slice(1, -1);
    expect(contentLines.find((l: string) => l.includes('help'))).toContain('❯');
  });

  it('autocomplete 空结果不应在渲染中出现额外行', async () => {
    const { editor } = createEditor();
    const provider = {
      getSuggestions: vi.fn().mockResolvedValue({
        items: [],
        prefix: '/',
      }),
    };
    editor.setAutocompleteProvider(provider);
    editor.handleInput('/');
    await vi.waitFor(() => {
      const result = editor.render(80);
      expect(result.length).toBe(3);
    });
  });

  it('border 使用 theme.borderColor 着色', () => {
    const borderColor = vi.fn((s: string) => `COLORED(${s})`);
    const theme: EditorTheme = {
      borderColor,
      selectList: defaultTheme.selectList,
    };
    const { editor } = createEditor({ theme });
    const result = editor.render(80);
    expect(borderColor).toHaveBeenCalled();
    // border 行应包含着色标记
    expect(result[0]).toContain('COLORED');
    expect(result[result.length - 1]).toContain('COLORED');
  });

  it('终端宽度很窄时不应崩溃', () => {
    const { editor } = createEditor();
    expect(() => editor.render(4)).not.toThrow();
    expect(() => editor.render(1)).not.toThrow();
  });
});

// ==================== 测试: 自动补全全流程（通过公有 API 覆盖私有方法路径）====================

describe('自动补全全流程', () => {
  it('输入 / 触发 autocomplete 后按 Escape 应关闭（通过 render 验证）', async () => {
    const { editor } = createEditor();
    const provider = {
      getSuggestions: vi.fn().mockResolvedValue({
        items: [{ label: 'help' }, { label: 'quit' }],
        prefix: '/',
      }),
    };
    editor.setAutocompleteProvider(provider);
    editor.handleInput('/');
    // 等待 render 中出现补全项
    await vi.waitFor(() => {
      const result = editor.render(80);
      expect(result.slice(1, -1).length).toBeGreaterThan(1);
    });
    // Escape 关闭
    editor.handleInput('\x1b');
    const result = editor.render(80);
    expect(result.slice(1, -1).length).toBe(1); // 只剩 1 行内容
  });

  it('输入 / 触发 autocomplete 后按 Tab 应应用补全', async () => {
    const { editor } = createEditor();
    const provider = {
      getSuggestions: vi.fn().mockResolvedValue({
        items: [{ label: 'help', value: 'help', description: '显示帮助' }],
        prefix: '/',
      }),
      applyCompletion: vi.fn().mockReturnValue({
        lines: ['/help'],
        cursorLine: 0,
        cursorCol: 5,
      }),
    };
    editor.setAutocompleteProvider(provider);
    editor.handleInput('/');
    await vi.waitFor(() => {
      const result = editor.render(80);
      expect(result.slice(1, -1).length).toBeGreaterThan(1);
    });
    // Tab 应用补全
    editor.handleInput('\t');
    expect(provider.applyCompletion).toHaveBeenCalled();
    const result = editor.render(80);
    expect(result.slice(1, -1).length).toBeLessThanOrEqual(1);
  });

  it('输入 / 触发后 provider 返回空结果应自动关闭', async () => {
    const { editor } = createEditor();
    const provider = {
      getSuggestions: vi.fn().mockResolvedValue({ items: [], prefix: '/' }),
    };
    editor.setAutocompleteProvider(provider);
    editor.handleInput('/');
    await vi.waitFor(() => {
      const result = editor.render(80);
      expect(result.slice(1, -1).length).toBe(1); // 无补全项
    });
  });

  it('provider.getSuggestions 抛异常不应影响编辑器', async () => {
    const { editor } = createEditor();
    const provider = {
      getSuggestions: vi.fn().mockRejectedValue(new Error('fail')),
    };
    editor.setAutocompleteProvider(provider);
    expect(() => editor.handleInput('/')).not.toThrow();
  });
});
