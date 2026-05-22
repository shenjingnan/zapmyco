import { describe, expect, it } from 'vitest';
import { setClipboard } from '@/cli/tui/clipboard';

describe('setClipboard', () => {
  it('应生成正确的 OSC 52 序列', () => {
    const result = setClipboard('hello');
    expect(result).toBe('\x1b]52;c;aGVsbG8=\x07');
  });

  it('空文本应返回 null', () => {
    expect(setClipboard('')).toBeNull();
  });

  it('包含中文的文本应正确编码', () => {
    const result = setClipboard('你好');
    // Buffer.from('你好', 'utf-8').toString('base64') → '5L2g5aW9'
    expect(result).toBe('\x1b]52;c;5L2g5aW9\x07');
  });

  it('tmux 环境下应添加 DCS passthrough', () => {
    const prev = process.env.TMUX;
    process.env.TMUX = '1';
    try {
      const result = setClipboard('hi');
      expect(result).toContain('\x1bPtmux;');
      expect(result).toContain('\x1b\\');
    } finally {
      process.env.TMUX = prev;
    }
  });

  it('非 tmux 环境下不应包含 DCS 前缀', () => {
    const prev = process.env.TMUX;
    process.env.TMUX = '';
    try {
      const result = setClipboard('test');
      expect(result).not.toContain('\x1bPtmux;');
      expect(result).not.toContain('\x1b\\');
    } finally {
      process.env.TMUX = prev;
    }
  });
});
