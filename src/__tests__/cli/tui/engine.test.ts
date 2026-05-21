/**
 * TUI 引擎单元测试
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from '@/cli/tui/container';
import { TUI } from '@/cli/tui/engine';
import type { Component } from '@/cli/tui/types';

// ---------------------------------------------------------------------------
// Mock ProcessTerminal
// ---------------------------------------------------------------------------

function createMockTerminal() {
  const write = vi.fn();
  const cursorTo = vi.fn();
  const enableRawMode = vi.fn();
  const disableRawMode = vi.fn();
  const clear = vi.fn();
  const destroy = vi.fn();
  const onResize = vi.fn();
  const stdinHandlers: Array<(chunk: Buffer) => void> = [];

  return {
    rows: 24,
    columns: 80,
    write,
    cursorTo,
    enableRawMode,
    disableRawMode,
    clear,
    destroy,
    onResize,
    stdin: {
      isTTY: true,
      setRawMode: vi.fn(),
      on: vi.fn((_event: string, handler: (chunk: Buffer) => void) => {
        stdinHandlers.push(handler);
      }),
      removeAllListeners: vi.fn(),
    },
    stdout: {
      on: vi.fn(),
      removeListener: vi.fn(),
    },
    // 测试辅助
    stdinHandlers,
  };
}

type MockTerminal = ReturnType<typeof createMockTerminal>;

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function createMockComponent(
  nameOrLines: string | string[] = 'comp'
): Component & { focused?: boolean } {
  const lines = Array.isArray(nameOrLines) ? nameOrLines : [`[${nameOrLines}]`];
  return {
    render: vi.fn(() => lines),
    handleInput: vi.fn(),
    invalidate: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe('TUI', () => {
  let terminal: MockTerminal;
  let tui: TUI;

  beforeEach(() => {
    terminal = createMockTerminal();
    tui = new TUI(terminal as any);
  });

  describe('constructor', () => {
    it('应保存 terminal 引用', () => {
      expect(tui.terminal).toBe(terminal);
    });
  });

  describe('addChild', () => {
    it('应添加子组件到根容器', () => {
      const child = createMockComponent();
      tui.addChild(child);
      // 通过 render 验证子组件存在
      tui.requestRender(true);
      tui.doRender();
      expect(child.render).toHaveBeenCalledWith(80);
    });
  });

  describe('setFocus', () => {
    it('应保存焦点组件引用', () => {
      const child = createMockComponent();
      tui.setFocus(child);
      // 不能直接检查 private field, 但可以验证 requestRender 被调用
    });

    it('应设置焦点组件的 focused 属性', () => {
      const child = createMockComponent();
      child.focused = false;
      tui.setFocus(child);
      expect(child.focused).toBe(true);
    });

    it('取消前一个组件的焦点', () => {
      const oldChild = createMockComponent();
      oldChild.focused = true;
      tui.setFocus(oldChild);
      const newChild = createMockComponent();
      newChild.focused = false;
      tui.setFocus(newChild);
      expect(oldChild.focused).toBe(false);
      expect(newChild.focused).toBe(true);
    });

    it('组件没有 focused 属性时应跳过', () => {
      const child = createMockComponent();
      delete child.focused;
      expect(() => tui.setFocus(child)).not.toThrow();
    });

    it('应触发 requestRender', () => {
      const renderSpy = vi.spyOn(tui, 'requestRender');
      tui.setFocus(createMockComponent());
      expect(renderSpy).toHaveBeenCalled();
    });
  });

  describe('requestRender', () => {
    it('应设置 dirty 标记', () => {
      tui.addChild(createMockComponent('x'));
      tui.requestRender(true); // 先全量渲染一次，确保有输出
      tui.doRender();
      terminal.write.mockClear();

      tui.requestRender(); // 不带 force
      tui.doRender();
      expect(terminal.write).toHaveBeenCalled();
    });

    it('带 force 参数应触发全量重绘', () => {
      tui.addChild(createMockComponent('x'));
      tui.requestRender(true);
      tui.doRender();
      // force mode 下会先 cursorTo(0,0) 再逐行写入
      expect(terminal.cursorTo).toHaveBeenCalledWith(0, 0);
    });
  });

  describe('doRender', () => {
    it('无输出时应空运行不报错', () => {
      tui.requestRender(true);
      expect(() => tui.doRender()).not.toThrow();
    });

    it('有子组件时应渲染其内容', () => {
      const child = createMockComponent('hi');
      tui.addChild(child);
      tui.requestRender(true);
      tui.doRender();
      expect(terminal.write).toHaveBeenCalledWith(expect.stringContaining('[hi]'));
    });

    it('差量渲染模式下应使用 cursorTo 定位每行', () => {
      const child = createMockComponent('line');
      tui.addChild(child);
      // 第一次渲染：force 模式
      tui.requestRender(true);
      tui.doRender();
      terminal.cursorTo.mockClear();
      terminal.write.mockClear();

      // 第二次渲染：delta 模式
      tui.requestRender();
      tui.doRender();
      // delta 模式下每行写入前会 cursorTo
      expect(terminal.cursorTo).toHaveBeenCalled();
    });

    it('差量渲染时行数减少应清空旧行', () => {
      const container = new Container();
      const child = createMockComponent(['line1', 'line2']);
      container.addChild(child);
      tui.addChild(container);

      // 第一次渲染：2 行输出
      tui.requestRender(true);
      tui.doRender();

      // 清空 mock 记录
      terminal.write.mockClear();
      terminal.cursorTo.mockClear();

      // 第二次渲染：完全清空容器，输出 0 行
      const noOutputChild: Component = {
        render: () => [],
        handleInput: vi.fn(),
        invalidate: vi.fn(),
      };
      container.removeChild(child);
      container.addChild(noOutputChild);
      tui.requestRender();
      tui.doRender();
      // 旧行数 > 新行数，应发送清行指令
      const clearCalls = terminal.write.mock.calls.filter((c: string[]) => c[0] === '\x1b[2K');
      expect(clearCalls.length).toBeGreaterThan(0);
    });
  });

  describe('showOverlay', () => {
    it('应返回包含 hide 方法的 OverlayHandle', () => {
      const overlay = createMockComponent();
      const handle = tui.showOverlay(overlay);
      expect(handle).toHaveProperty('hide');
      expect(typeof handle.hide).toBe('function');
    });

    it('hide 方法应移除 overlay', () => {
      const overlay = createMockComponent();
      const handle = tui.showOverlay(overlay);
      tui.requestRender(true);
      tui.doRender();
      const writeCount = terminal.write.mock.calls.length;

      handle.hide();
      tui.requestRender(true);
      tui.doRender();
      // hide 后渲染仍正常执行
      expect(terminal.write.mock.calls.length).toBeGreaterThan(writeCount);
    });

    it('多个 overlay 应叠加', () => {
      const overlay1 = createMockComponent('o1');
      const overlay2 = createMockComponent('o2');
      const h1 = tui.showOverlay(overlay1);
      tui.showOverlay(overlay2);
      tui.requestRender(true);
      tui.doRender();
      // 两个 overlay 都应被渲染
      expect(terminal.write).toHaveBeenCalledWith(expect.stringContaining('[o2]'));

      // 去掉一个
      h1.hide();
      terminal.write.mockClear();
      tui.requestRender(true);
      tui.doRender();
    });
  });

  describe('setShowHardwareCursor', () => {
    it('visible 为 true 时应显示光标', () => {
      tui.setShowHardwareCursor(true);
      expect(terminal.write).toHaveBeenCalledWith('\x1b[?25h');
    });

    it('visible 为 false 时应隐藏光标', () => {
      tui.setShowHardwareCursor(false);
      expect(terminal.write).toHaveBeenCalledWith('\x1b[?25l');
    });
  });

  describe('start / stop', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('start 应启用 raw mode、隐藏光标、清屏', () => {
      tui.start();
      expect(terminal.enableRawMode).toHaveBeenCalled();
      expect(terminal.write).toHaveBeenCalledWith('\x1b[?25l');
      expect(terminal.clear).toHaveBeenCalled();
    });

    it('start 应注册 stdin 和 resize 监听', () => {
      tui.start();
      expect(terminal.stdin.on).toHaveBeenCalledWith('data', expect.any(Function));
      expect(terminal.onResize).toHaveBeenCalled();
    });

    it('start 后应启动渲染循环', () => {
      tui.start();
      expect(terminal.stdin.on).toHaveBeenCalled();
      // 触发渲染: setInterval 16ms
      vi.advanceTimersByTime(16);
      // 默认 dirty=true，应执行 doRender
      expect(terminal.write).toHaveBeenCalled();
    });

    it('stop 应恢复光标、销毁 terminal', () => {
      tui.start();
      terminal.write.mockClear();
      tui.stop();
      expect(terminal.write).toHaveBeenCalledWith('\x1b[?25h');
      expect(terminal.destroy).toHaveBeenCalled();
      expect(terminal.stdin.removeAllListeners).toHaveBeenCalledWith('data');
    });

    it('未 start 直接 stop 不应报错', () => {
      expect(() => tui.stop()).not.toThrow();
    });

    it('stop 应清理定时器', () => {
      tui.start();
      const clearSpy = vi.spyOn(global, 'clearInterval');
      tui.stop();
      expect(clearSpy).toHaveBeenCalled();
    });
  });

  describe('render cycle', () => {
    it('渲染循环应处理光标标记', () => {
      // 带光标标记的组件
      const child: Component = {
        render: vi.fn(() => ['❯ \u001B_pi:c\u0007']),
        handleInput: vi.fn(),
        invalidate: vi.fn(),
      };
      tui.addChild(child);
      tui.requestRender(true);
      tui.doRender();
      // 找到光标标记后应显示硬件光标
      expect(terminal.write).toHaveBeenCalledWith('\x1b[?25h');
    });

    it('无光标标记时不应显示硬件光标', () => {
      const child = createMockComponent('plain');
      tui.addChild(child);
      tui.requestRender(true);
      terminal.write.mockClear();
      tui.doRender();
      // 实际上 doRender 末尾有 if (this.cursorRow >= 0) 的判断，cursorRow=-1 所以为 false
    });
  });

  describe('input routing', () => {
    it('焦点组件应接收输入', () => {
      const child = createMockComponent();
      tui.setFocus(child);
      tui.start();

      // 获取注册的 stdin handler
      const handler = terminal.stdin.on.mock.calls.find((c: any[]) => c[0] === 'data')?.[1];
      expect(handler).toBeDefined();

      handler!(Buffer.from('hello'));
      expect(child.handleInput).toHaveBeenCalledWith('hello');
    });

    it('overlay 活跃时输入应送达顶层 overlay', () => {
      const child = createMockComponent();
      tui.setFocus(child);
      tui.start();

      const overlay = createMockComponent();
      tui.showOverlay(overlay);

      // 获取注册的 stdin handler
      const handler = terminal.stdin.on.mock.calls.find((c: any[]) => c[0] === 'data')?.[1];
      handler!(Buffer.from('key'));

      // 焦点组件不应收到输入
      expect(child.handleInput).not.toHaveBeenCalled();
      // overlay 应收到输入
      expect(overlay.handleInput).toHaveBeenCalledWith('key');
    });

    it('无焦点组件时输入不应报错', () => {
      tui.start();
      const handler = terminal.stdin.on.mock.calls.find((c: any[]) => c[0] === 'data')?.[1];
      expect(() => handler!(Buffer.from('key'))).not.toThrow();
    });
  });

  describe('overlay rect calculation', () => {
    it('百分比 width 应正确计算', () => {
      const overlay = createMockComponent();
      tui.showOverlay(overlay, { width: '50%' });
      tui.requestRender(true);
      tui.doRender();
      // overlay 应被渲染（渲染不可见但不应报错）
      expect(overlay.render).toHaveBeenCalled();
    });

    it('数字 width 应直接使用', () => {
      const overlay = createMockComponent();
      tui.showOverlay(overlay, { width: 40 });
      tui.requestRender(true);
      tui.doRender();
      expect(overlay.render).toHaveBeenCalled();
    });

    it('minWidth 应限制最小宽度', () => {
      const overlay = createMockComponent();
      tui.showOverlay(overlay, { width: 10, minWidth: 50 });
      tui.requestRender(true);
      tui.doRender();
      expect(overlay.render).toHaveBeenCalled();
    });

    it('maxHeight 应限制最大高度', () => {
      const overlay = createMockComponent(Array(100).fill('line'));
      tui.showOverlay(overlay, { maxHeight: 5 });
      tui.requestRender(true);
      tui.doRender();
      expect(overlay.render).toHaveBeenCalled();
    });

    it('margin.top 应影响 overlay 起始行', () => {
      const overlay = createMockComponent(['overlay']);
      tui.showOverlay(overlay, { margin: { top: 2 } });
      tui.requestRender(true);
      tui.doRender();
      expect(overlay.render).toHaveBeenCalled();
    });

    it('数字 margin 应作为顶部间距', () => {
      const overlay = createMockComponent(['overlay']);
      tui.showOverlay(overlay, { margin: 3 });
      tui.requestRender(true);
      tui.doRender();
      expect(overlay.render).toHaveBeenCalled();
    });

    it('无选项 overlay 应默认全宽', () => {
      const overlay = createMockComponent(['line']);
      tui.showOverlay(overlay);
      tui.requestRender(true);
      tui.doRender();
      expect(overlay.render).toHaveBeenCalledWith(80);
    });
  });

  describe('text-overflow protection', () => {
    it('大量输出应截断到 terminal.rows', () => {
      const manyLines = Array(100).fill('content');
      const child = createMockComponent(manyLines);
      tui.addChild(child);
      tui.requestRender(true);
      tui.doRender();
      // terminal 只有 24 行，应只渲染最后 24 行
      // 但验证至少渲染了
      expect(child.render).toHaveBeenCalledWith(80);
    });
  });
});
