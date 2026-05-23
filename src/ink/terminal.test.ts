/**
 * Terminal — 终端 I/O 封装单元测试
 *
 * PR6: 新增终端能力检测测试
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// detectSyncOutputSupport
// ---------------------------------------------------------------------------

describe('detectSyncOutputSupport', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('tmux 应返回 false', async () => {
    process.env.TERM_PROGRAM = 'tmux';
    // 动态导入以刷新缓存
    const { detectSyncOutputSupport } = await import('./terminal');
    expect(detectSyncOutputSupport()).toBe(false);
  });

  it('TERM 含 tmux 也应返回 false', async () => {
    process.env.TERM = 'tmux-256color';
    const { detectSyncOutputSupport } = await import('./terminal');
    expect(detectSyncOutputSupport()).toBe(false);
  });

  it('iTerm2 应返回 true', async () => {
    process.env.TERM_PROGRAM = 'iTerm.app';
    const { detectSyncOutputSupport } = await import('./terminal');
    expect(detectSyncOutputSupport()).toBe(true);
  });

  it('kitty 应返回 true', async () => {
    process.env.TERM_PROGRAM = 'kitty';
    const { detectSyncOutputSupport } = await import('./terminal');
    expect(detectSyncOutputSupport()).toBe(true);
  });

  it('vscode 应返回 true', async () => {
    process.env.TERM_PROGRAM = 'vscode';
    const { detectSyncOutputSupport } = await import('./terminal');
    expect(detectSyncOutputSupport()).toBe(true);
  });

  it('默认（未知终端）应返回 false', async () => {
    process.env.TERM_PROGRAM = 'unknown-terminal';
    process.env.TERM = 'xterm';
    const { detectSyncOutputSupport } = await import('./terminal');
    expect(detectSyncOutputSupport()).toBe(false);
  });

  it('VTE 终端应返回 true', async () => {
    process.env.TERM_PROGRAM = 'gnome-terminal';
    process.env.TERM = 'vte-6800';
    const { detectSyncOutputSupport } = await import('./terminal');
    expect(detectSyncOutputSupport()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectColorLevel
// ---------------------------------------------------------------------------

describe('detectColorLevel', () => {
  it('应返回合法的色彩级别', async () => {
    const { detectColorLevel } = await import('./terminal');
    const level = detectColorLevel();
    expect(['truecolor', '256', '16', '8']).toContain(level);
  });
});

// ---------------------------------------------------------------------------
// isSynchronizedOutputSupported (cached)
// ---------------------------------------------------------------------------

describe('isSynchronizedOutputSupported', () => {
  it('应返回布尔值', async () => {
    const { isSynchronizedOutputSupported } = await import('./terminal');
    const result = isSynchronizedOutputSupported();
    expect(typeof result).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// getColorLevel
// ---------------------------------------------------------------------------

describe('getColorLevel', () => {
  it('应返回合法的色彩级别', async () => {
    const { getColorLevel } = await import('./terminal');
    const level = getColorLevel();
    expect(['truecolor', '256', '16', '8']).toContain(level);
  });
});
