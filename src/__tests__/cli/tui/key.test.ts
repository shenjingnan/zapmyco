/**
 * Key 模块单元测试
 */
import { describe, expect, it } from 'vitest';
import { Key, matchesKey } from '@/cli/tui/key';

// ---------------------------------------------------------------------------
// Key 常量
// ---------------------------------------------------------------------------

describe('Key 常量', () => {
  it('应定义所有命名键常量', () => {
    expect(Key.escape).toBe('escape');
    expect(Key.enter).toBe('enter');
    expect(Key.tab).toBe('tab');
    expect(Key.space).toBe('space');
    expect(Key.backspace).toBe('backspace');
    expect(Key.up).toBe('up');
    expect(Key.down).toBe('down');
    expect(Key.left).toBe('left');
    expect(Key.right).toBe('right');
    expect(Key.pageup).toBe('pageup');
    expect(Key.pagedown).toBe('pagedown');
  });
});

describe('Key.ctrl', () => {
  it('应生成 ctrl 组合键标识', () => {
    expect(Key.ctrl('c')).toBe('ctrl+c');
    expect(Key.ctrl('a')).toBe('ctrl+a');
    expect(Key.ctrl('z')).toBe('ctrl+z');
  });

  it('应保留大小写', () => {
    expect(Key.ctrl('C')).toBe('ctrl+C');
    expect(Key.ctrl('A')).toBe('ctrl+A');
  });
});

describe('Key.ctrlShift', () => {
  it('应生成 ctrl+shift 组合键标识', () => {
    expect(Key.ctrlShift('c')).toBe('ctrl+shift+c');
    expect(Key.ctrlShift('x')).toBe('ctrl+shift+x');
  });

  it('应保留大小写', () => {
    expect(Key.ctrlShift('C')).toBe('ctrl+shift+C');
  });
});

// ---------------------------------------------------------------------------
// matchesKey — 命名键
// ---------------------------------------------------------------------------

describe('matchesKey — 命名键匹配', () => {
  it('应匹配 escape', () => {
    expect(matchesKey('\x1b', 'escape')).toBe(true);
  });

  it('应匹配 enter', () => {
    expect(matchesKey('\r', 'enter')).toBe(true);
  });

  it('应匹配 tab', () => {
    expect(matchesKey('\t', 'tab')).toBe(true);
  });

  it('应匹配 space', () => {
    expect(matchesKey(' ', 'space')).toBe(true);
  });

  it('应匹配 backspace', () => {
    expect(matchesKey('\x7f', 'backspace')).toBe(true);
  });

  it('应匹配方向键', () => {
    expect(matchesKey('\x1b[A', 'up')).toBe(true);
    expect(matchesKey('\x1b[B', 'down')).toBe(true);
    expect(matchesKey('\x1b[D', 'left')).toBe(true);
    expect(matchesKey('\x1b[C', 'right')).toBe(true);
  });

  it('应匹配 home 和 end', () => {
    expect(matchesKey('\x1b[H', 'home')).toBe(true);
    expect(matchesKey('\x1b[F', 'end')).toBe(true);
  });

  it('应匹配 pageup 和 pagedown', () => {
    expect(matchesKey('\x1b[5~', 'pageup')).toBe(true);
    expect(matchesKey('\x1b[6~', 'pagedown')).toBe(true);
  });

  it('命名键不匹配时应返回 false', () => {
    expect(matchesKey('\x1b', 'up')).toBe(false);
    expect(matchesKey('\x1b[A', 'escape')).toBe(false);
    expect(matchesKey('\r', 'tab')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesKey — Ctrl 组合键（ASCII 控制字符）
// ---------------------------------------------------------------------------

describe('matchesKey — Ctrl 组合键（传统协议）', () => {
  it('应匹配 ctrl+a 到 ctrl+z', () => {
    expect(matchesKey('\x01', 'ctrl+a')).toBe(true);
    expect(matchesKey('\x02', 'ctrl+b')).toBe(true);
    expect(matchesKey('\x03', 'ctrl+c')).toBe(true);
    expect(matchesKey('\x04', 'ctrl+d')).toBe(true);
    expect(matchesKey('\x05', 'ctrl+e')).toBe(true);
    expect(matchesKey('\x06', 'ctrl+f')).toBe(true);
    expect(matchesKey('\x07', 'ctrl+g')).toBe(true);
    expect(matchesKey('\x08', 'ctrl+h')).toBe(true);
    expect(matchesKey('\x09', 'ctrl+i')).toBe(true);
    expect(matchesKey('\x0a', 'ctrl+j')).toBe(true);
    expect(matchesKey('\x0b', 'ctrl+k')).toBe(true);
    expect(matchesKey('\x0c', 'ctrl+l')).toBe(true);
    expect(matchesKey('\x0d', 'ctrl+m')).toBe(true);
    expect(matchesKey('\x0e', 'ctrl+n')).toBe(true);
    expect(matchesKey('\x0f', 'ctrl+o')).toBe(true);
    expect(matchesKey('\x10', 'ctrl+p')).toBe(true);
    expect(matchesKey('\x11', 'ctrl+q')).toBe(true);
    expect(matchesKey('\x12', 'ctrl+r')).toBe(true);
    expect(matchesKey('\x13', 'ctrl+s')).toBe(true);
    expect(matchesKey('\x14', 'ctrl+t')).toBe(true);
    expect(matchesKey('\x15', 'ctrl+u')).toBe(true);
    expect(matchesKey('\x16', 'ctrl+v')).toBe(true);
    expect(matchesKey('\x17', 'ctrl+w')).toBe(true);
    expect(matchesKey('\x18', 'ctrl+x')).toBe(true);
    expect(matchesKey('\x19', 'ctrl+y')).toBe(true);
    expect(matchesKey('\x1a', 'ctrl+z')).toBe(true);
  });

  it('ctrl 组合键不匹配时应返回 false', () => {
    expect(matchesKey('\x03', 'ctrl+d')).toBe(false);
    expect(matchesKey('\x01', 'ctrl+c')).toBe(false);
  });

  it('应匹配 ctrl+shift 组合键（传统协议与 ctrl 相同）', () => {
    // 传统字节级编码中 ctrl 和 ctrl+shift 使用相同 ASCII 控制字符
    expect(matchesKey('\x01', 'ctrl+shift+a')).toBe(true);
    expect(matchesKey('\x03', 'ctrl+shift+c')).toBe(true);
    expect(matchesKey('\x1a', 'ctrl+shift+z')).toBe(true);
  });

  it('应匹配大写字母键标识', () => {
    expect(matchesKey('\x03', 'ctrl+C')).toBe(true);
    expect(matchesKey('\x03', 'ctrl+shift+C')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// matchesKey — shift+tab
// ---------------------------------------------------------------------------

describe('matchesKey — shift+tab', () => {
  it('应匹配 shift+tab', () => {
    expect(matchesKey('\x1b[Z', 'shift+tab')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// matchesKey — Ctrl+Home / Ctrl+End
// ---------------------------------------------------------------------------

describe('matchesKey — Ctrl+Home / Ctrl+End', () => {
  it('应匹配 Ctrl+Home 的 xterm modifyOtherKeys 序列', () => {
    expect(matchesKey('\x1b[1;5H', 'ctrl+home')).toBe(true);
  });

  it('应匹配 Ctrl+Home 的 CSI-u 序列', () => {
    expect(matchesKey('\x1b[72;5u', 'ctrl+home')).toBe(true);
  });

  it('应匹配 Ctrl+Home 的 modifyOtherKeys mode 2 序列', () => {
    expect(matchesKey('\x1b[27;5;72~', 'ctrl+home')).toBe(true);
  });

  it('应匹配 Ctrl+End 的 xterm modifyOtherKeys 序列', () => {
    expect(matchesKey('\x1b[1;5F', 'ctrl+end')).toBe(true);
  });

  it('应匹配 Ctrl+End 的 CSI-u 序列', () => {
    expect(matchesKey('\x1b[70;5u', 'ctrl+end')).toBe(true);
  });

  it('应匹配 Ctrl+End 的 modifyOtherKeys mode 2 序列', () => {
    expect(matchesKey('\x1b[27;5;70~', 'ctrl+end')).toBe(true);
  });

  it('Ctrl+Home 不应匹配普通 Home', () => {
    expect(matchesKey('\x1b[H', 'ctrl+home')).toBe(false);
  });

  it('Ctrl+End 不应匹配普通 End', () => {
    expect(matchesKey('\x1b[F', 'ctrl+end')).toBe(false);
  });

  it('Ctrl+Home/Ctrl+End 不应匹配其他 Ctrl 组合键', () => {
    expect(matchesKey('\x03', 'ctrl+home')).toBe(false);
    expect(matchesKey('\x03', 'ctrl+end')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesKey — CSI-u 协议（Kitty/iTerm2）
// ---------------------------------------------------------------------------

describe('matchesKey — CSI-u 协议（Kitty/iTerm2）', () => {
  it('应匹配 CSI-u 协议的 ctrl 组合键', () => {
    // ESC [ <charCode> ; 5 u
    expect(matchesKey('\x1b[99;5u', 'ctrl+c')).toBe(true);
    expect(matchesKey('\x1b[97;5u', 'ctrl+a')).toBe(true);
    expect(matchesKey('\x1b[122;5u', 'ctrl+z')).toBe(true);
  });

  it('应匹配 CSI-u 协议的 ctrl+shift 组合键', () => {
    // ESC [ <charCode> ; 6 u
    expect(matchesKey('\x1b[99;6u', 'ctrl+shift+c')).toBe(true);
    expect(matchesKey('\x1b[97;6u', 'ctrl+shift+a')).toBe(true);
  });

  it('CSI-u 解析为不同键时返回 false', () => {
    // 解析为 ctrl+c，但请求 ctrl+shift+c
    expect(matchesKey('\x1b[99;5u', 'ctrl+shift+c')).toBe(false);
    // 解析为 ctrl+c，但请求 ctrl+x
    expect(matchesKey('\x1b[99;5u', 'ctrl+x')).toBe(false);
  });

  it('非 5/6 修饰符回退到传统匹配', () => {
    // modifier=2 (shift) -> parseKey 返回 undefined -> legacyMatch
    expect(matchesKey('\x1b[99;2u', 'ctrl+c')).toBe(false);
    // modifier=3 (alt)
    expect(matchesKey('\x1b[99;3u', 'ctrl+c')).toBe(false);
    // modifier=4 (alt+shift)
    expect(matchesKey('\x1b[99;4u', 'ctrl+c')).toBe(false);
    // modifier=7 (ctrl+alt)
    expect(matchesKey('\x1b[99;7u', 'ctrl+c')).toBe(false);
    // modifier=8 (ctrl+alt+shift)
    expect(matchesKey('\x1b[99;8u', 'ctrl+c')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesKey — modifyOtherKeys 协议
// ---------------------------------------------------------------------------

describe('matchesKey — modifyOtherKeys 协议', () => {
  it('应匹配 modifyOtherKeys 的 ctrl 组合键', () => {
    // ESC [ 27 ; 5 ; <charCode> ~
    expect(matchesKey('\x1b[27;5;99~', 'ctrl+c')).toBe(true);
    expect(matchesKey('\x1b[27;5;97~', 'ctrl+a')).toBe(true);
    expect(matchesKey('\x1b[27;5;122~', 'ctrl+z')).toBe(true);
  });

  it('应匹配 modifyOtherKeys 的 ctrl+shift 组合键', () => {
    // ESC [ 27 ; 6 ; <charCode> ~
    expect(matchesKey('\x1b[27;6;99~', 'ctrl+shift+c')).toBe(true);
    expect(matchesKey('\x1b[27;6;97~', 'ctrl+shift+a')).toBe(true);
  });

  it('modifyOtherKeys 解析为不同键时返回 false', () => {
    expect(matchesKey('\x1b[27;5;99~', 'ctrl+shift+c')).toBe(false);
    expect(matchesKey('\x1b[27;5;99~', 'ctrl+x')).toBe(false);
  });

  it('非 5/6 修饰符回退到传统匹配', () => {
    // modifier=2 (shift)
    expect(matchesKey('\x1b[27;2;99~', 'ctrl+c')).toBe(false);
    // modifier=3 (alt)
    expect(matchesKey('\x1b[27;3;99~', 'ctrl+c')).toBe(false);
    // modifier=4 (alt+shift)
    expect(matchesKey('\x1b[27;4;99~', 'ctrl+c')).toBe(false);
    // modifier=7 (ctrl+alt)
    expect(matchesKey('\x1b[27;7;99~', 'ctrl+c')).toBe(false);
    // modifier=8 (ctrl+alt+shift)
    expect(matchesKey('\x1b[27;8;99~', 'ctrl+c')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesKey — 边界场景
// ---------------------------------------------------------------------------

describe('matchesKey — 边界场景', () => {
  it('空数据应返回 false', () => {
    expect(matchesKey('', 'escape')).toBe(false);
    expect(matchesKey('', 'ctrl+c')).toBe(false);
    expect(matchesKey('', 'up')).toBe(false);
  });

  it('未知键标识应返回 false', () => {
    expect(matchesKey('\x1b', 'nonexistent')).toBe(false);
    expect(matchesKey('\x03', 'unknown')).toBe(false);
  });

  it('未知序列应返回 false', () => {
    expect(matchesKey('\x1b[X', 'escape')).toBe(false);
    expect(matchesKey('\x1b[Z', 'escape')).toBe(false);
    expect(matchesKey('\x1b[', 'escape')).toBe(false);
  });

  it('非字母 ctrl 组合键应返回 false', () => {
    // ctrl+1、ctrl+/ 等不应被 legacyMatch 处理
    expect(matchesKey('\x00', 'ctrl+@')).toBe(false);
    // 但注意 ctrl+`@` 实际上会产生 \x00，这里测试的是 keyId 格式
  });

  it('CSI-u 和 modifyOtherKeys 应返回相同结果', () => {
    // 两种协议对同一逻辑键应一致
    expect(matchesKey('\x1b[99;5u', 'ctrl+c')).toBe(true);
    expect(matchesKey('\x1b[27;5;99~', 'ctrl+c')).toBe(true);
    expect(matchesKey('\x1b[99;6u', 'ctrl+shift+c')).toBe(true);
    expect(matchesKey('\x1b[27;6;99~', 'ctrl+shift+c')).toBe(true);
  });

  it('传统序列不应被高级协议误解析', () => {
    // \x1b[A 是方向键上，不应被 CSI-u 或 modifyOtherKeys 匹配
    expect(matchesKey('\x1b[A', 'ctrl+a')).toBe(false);
    expect(matchesKey('\x1b[A', 'ctrl+shift+a')).toBe(false);

    // \x1b 是 escape
    expect(matchesKey('\x1b', 'ctrl+\\')).toBe(false);
  });
});
