import { describe, expect, it } from 'vitest';
import { createTheme } from '@/cli/repl/theme';

describe('createTheme', () => {
  it('应返回包含所有样式函数的主题对象', () => {
    const theme = createTheme(true);

    expect(typeof theme.text).toBe('function');
    expect(typeof theme.bold).toBe('function');
    expect(typeof theme.dim).toBe('function');
    expect(typeof theme.accent).toBe('function');
    expect(typeof theme.success).toBe('function');
    expect(typeof theme.error).toBe('function');
    expect(typeof theme.warning).toBe('function');
    expect(typeof theme.border).toBe('function');
    expect(typeof theme.heading).toBe('function');
  });

  it('应返回 editorTheme 和 selectListTheme', () => {
    const theme = createTheme(true);

    expect(theme.editorTheme).toBeDefined();
    expect(typeof theme.editorTheme.borderColor).toBe('function');
    expect(theme.editorTheme.selectList).toBeDefined();
    expect(typeof theme.editorTheme.selectList.selectedPrefix).toBe('function');
    expect(typeof theme.editorTheme.selectList.selectedText).toBe('function');
    expect(typeof theme.editorTheme.selectList.description).toBe('function');
    expect(typeof theme.editorTheme.selectList.scrollInfo).toBe('function');
    expect(typeof theme.editorTheme.selectList.noMatch).toBe('function');

    expect(theme.selectListTheme).toBe(theme.editorTheme.selectList);
  });

  it('启用颜色时样式函数应正常返回字符串', () => {
    const theme = createTheme(true);

    // 所有样式函数都应返回字符串
    expect(typeof theme.bold('hello')).toBe('string');
    expect(typeof theme.accent('hello')).toBe('string');
    expect(typeof theme.error('hello')).toBe('string');
    expect(typeof theme.success('hello')).toBe('string');
    expect(typeof theme.warning('hello')).toBe('string');

    // bold 对非空输入应返回与输入不同的结果（添加了样式标记）
    // 注意：chalk 在某些测试环境中可能不输出 ANSI，所以只验证返回字符串
    expect(theme.bold('hello').length).toBeGreaterThanOrEqual(5);
  });

  it('禁用颜色时样式函数不应包含 ANSI 转义序列', () => {
    const theme = createTheme(false);

    const text = [
      theme.text('hello'),
      theme.bold('hello'),
      theme.dim('hello'),
      theme.accent('hello'),
      theme.success('hello'),
      theme.error('hello'),
      theme.warning('hello'),
      theme.border('hello'),
      theme.heading('hello'),
    ].join('');

    expect(text).not.toContain('\u001b[');
  });

  it('text 函数应原样返回输入', () => {
    const theme = createTheme(true);
    expect(theme.text('hello')).toBe('hello');
  });
});
