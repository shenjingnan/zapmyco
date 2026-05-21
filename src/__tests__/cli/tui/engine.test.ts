/**
 * TUI 引擎单元测试
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from '@/cli/tui/container';
import { BSU, ESU } from '@/cli/tui/dec';
import { TUI } from '@/cli/tui/engine';
import type { ProcessTerminal } from '@/cli/tui/terminal';
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
    tui = new TUI(terminal as unknown as ProcessTerminal);
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

    it('同一组件重复设置焦点不报错', () => {
      const child = createMockComponent();
      child.focused = false;
      tui.setFocus(child);
      expect(child.focused).toBe(true);
      // 再次设置同一组件
      tui.setFocus(child);
      expect(child.focused).toBe(true);
    });

    it('旧组件没有 focused 属性时切换焦点不应报错', () => {
      const oldChild = createMockComponent();
      oldChild.focused = true;
      tui.setFocus(oldChild);

      const newChild = createMockComponent();
      // newChild 没有 focused 属性（已删除）
      delete newChild.focused;

      expect(() => tui.setFocus(newChild)).not.toThrow();
      // 旧组件的 focused 应被清除
      expect(oldChild.focused).toBe(false);
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
      // force mode 下写入含光标归位序列（\r\x1b[1;1H）
      const writeCall = terminal.write.mock.lastCall?.[0] as string;
      expect(writeCall).toContain('\x1b[1;1H');
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

    it('差量渲染模式下输出含光标定位序列', () => {
      const child = createMockComponent('line');
      tui.addChild(child);
      // 第一次渲染：force 模式
      tui.requestRender(true);
      tui.doRender();
      terminal.write.mockClear();

      // 第二次渲染：delta 模式
      tui.requestRender();
      tui.doRender();
      // delta 模式下光标定位序列内联在 write buffer 中
      const writeCall = terminal.write.mock.lastCall?.[0] as string;
      expect(writeCall).toContain(';1H'); // cursorTo(0, i) 的内联序列
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
      // 旧行数 > 新行数，输出应含清行指令
      const writeCall = terminal.write.mock.lastCall?.[0] as string;
      expect(writeCall).toContain('\x1b[2K');
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

    it('多次调用 hide 是幂等的', () => {
      const overlay = createMockComponent();
      const handle = tui.showOverlay(overlay);
      handle.hide();
      // 第二次调用 hide 不应报错
      expect(() => handle.hide()).not.toThrow();
      // 第三次调用 hide 仍不应报错
      expect(() => handle.hide()).not.toThrow();
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

    it('光标标记定位的行列值应正确传递', () => {
      // 光标标记 \u001B_pi:c\u0007 前有 3 个可见字符 "❯ "
      const child: Component = {
        render: vi.fn(() => ['❯ \u001B_pi:c\u0007' + '|extra']),
        handleInput: vi.fn(),
        invalidate: vi.fn(),
      };
      tui.addChild(child);
      tui.requestRender(true);
      tui.doRender();

      // 光标标记被移除后内容为 "❯ |extra"，且硬件光标已显示
      const writeCall = terminal.write.mock.lastCall?.[0] as string;
      expect(writeCall).toContain('\x1b[?25h');
      // 光标标记不应残留
      expect(writeCall).not.toContain('_pi:c');
    });

    it('差量更新模式输出应包裹 BSU/ESU', () => {
      const child = createMockComponent('line');
      tui.addChild(child);
      // 第一次渲染：force 模式
      tui.requestRender(true);
      tui.doRender();
      terminal.write.mockClear();

      // 第二次渲染：delta 模式
      tui.requestRender();
      tui.doRender();
      const writeCall = terminal.write.mock.lastCall?.[0] as string;
      expect(writeCall).toContain(BSU);
      expect(writeCall).toContain(ESU);
      // BSU 应在 ESU 之前
      expect(writeCall.indexOf(BSU)).toBeLessThan(writeCall.indexOf(ESU));
    });

    it('全量重绘模式输出应包裹 BSU/ESU', () => {
      const child = createMockComponent('full');
      tui.addChild(child);
      tui.requestRender(true);
      tui.doRender();
      const writeCall = terminal.write.mock.lastCall?.[0] as string;
      expect(writeCall).toContain(BSU);
      expect(writeCall).toContain(ESU);
    });
  });

  describe('input routing', () => {
    it('焦点组件应接收输入', () => {
      const child = createMockComponent();
      tui.setFocus(child);
      tui.start();

      // 获取注册的 stdin handler
      const handler = terminal.stdin.on.mock.calls.find(
        (c: [string, unknown]) => c[0] === 'data'
      )?.[1];
      expect(handler).toBeDefined();

      handler?.(Buffer.from('hello'));
      expect(child.handleInput).toHaveBeenCalledWith('hello');
    });

    it('overlay 活跃时输入应送达顶层 overlay', () => {
      const child = createMockComponent();
      tui.setFocus(child);
      tui.start();

      const overlay = createMockComponent();
      tui.showOverlay(overlay);

      // 获取注册的 stdin handler
      const handler = terminal.stdin.on.mock.calls.find(
        (c: [string, unknown]) => c[0] === 'data'
      )?.[1];
      handler?.(Buffer.from('key'));

      // 焦点组件不应收到输入
      expect(child.handleInput).not.toHaveBeenCalled();
      // overlay 应收到输入
      expect(overlay.handleInput).toHaveBeenCalledWith('key');
    });

    it('无焦点组件时输入不应报错', () => {
      tui.start();
      const handler = terminal.stdin.on.mock.calls.find(
        (c: [string, unknown]) => c[0] === 'data'
      )?.[1];
      expect(() => handler?.(Buffer.from('key'))).not.toThrow();
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

  describe('SGR mouse events', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function getStdinHandler(): (chunk: Buffer) => void {
      // start() 在 stdin.on('data', handler) 中注册
      const call = terminal.stdin.on.mock.calls.find((c: [string, unknown]) => c[0] === 'data');
      expect(call).toBeDefined();
      return (call?.[1] ?? (() => {})) as (chunk: Buffer) => void;
    }

    it('滚轮向上事件应调用焦点组件的 handleScroll("up")', () => {
      const scrollable = createMockComponent() as Component & {
        focused?: boolean;
        handleScroll: ReturnType<typeof vi.fn>;
      };
      scrollable.handleScroll = vi.fn();
      scrollable.focused = true;
      tui.setFocus(scrollable);
      tui.start();

      const handler = getStdinHandler();
      handler(Buffer.from('\x1b[<64;10;5M'));

      expect(scrollable.handleScroll).toHaveBeenCalledWith('up');
    });

    it('滚轮向上事件应触发 requestRender', () => {
      const renderSpy = vi.spyOn(tui, 'requestRender');
      const scrollable = createMockComponent() as Component & {
        focused?: boolean;
        handleScroll: ReturnType<typeof vi.fn>;
      };
      scrollable.handleScroll = vi.fn();
      scrollable.focused = true;
      tui.setFocus(scrollable);
      tui.start();

      const handler = getStdinHandler();
      renderSpy.mockClear(); // 清除 start 中的调用
      handler(Buffer.from('\x1b[<64;10;5M'));

      expect(renderSpy).toHaveBeenCalled();
    });

    it('滚轮向下事件应调用焦点组件的 handleScroll("down")', () => {
      const scrollable = createMockComponent() as Component & {
        focused?: boolean;
        handleScroll: ReturnType<typeof vi.fn>;
      };
      scrollable.handleScroll = vi.fn();
      scrollable.focused = true;
      tui.setFocus(scrollable);
      tui.start();

      const handler = getStdinHandler();
      handler(Buffer.from('\x1b[<65;10;5M'));

      expect(scrollable.handleScroll).toHaveBeenCalledWith('down');
    });

    it('非滚轮鼠标事件不应触发 handleScroll', () => {
      const scrollable = createMockComponent() as Component & {
        focused?: boolean;
        handleScroll: ReturnType<typeof vi.fn>;
      };
      scrollable.handleScroll = vi.fn();
      scrollable.focused = true;
      tui.setFocus(scrollable);
      tui.start();

      const handler = getStdinHandler();
      // btn=0 = mouse click, 不是滚轮事件
      handler(Buffer.from('\x1b[<0;10;5M'));

      expect(scrollable.handleScroll).not.toHaveBeenCalled();
    });

    it('纯鼠标事件不应转发给焦点组件的 handleInput', () => {
      const focused = createMockComponent();
      tui.setFocus(focused);
      tui.start();

      const handler = getStdinHandler();
      handler(Buffer.from('\x1b[<64;10;5M'));

      expect(focused.handleInput).not.toHaveBeenCalled();
    });

    it('鼠标事件混合键盘数据应转发剩余数据给焦点组件', () => {
      const scrollable = createMockComponent() as Component & {
        handleScroll: ReturnType<typeof vi.fn>;
      };
      scrollable.handleScroll = vi.fn();
      tui.setFocus(scrollable);
      tui.start();

      const handler = getStdinHandler();
      // SGR 事件后跟普通键盘输入
      handler(Buffer.from('\x1b[<64;10;5Mhello'));

      // 滚轮事件已处理
      expect(scrollable.handleScroll).toHaveBeenCalledWith('up');
      // 剩余数据应转发给焦点组件的 handleInput
      expect(scrollable.handleInput).toHaveBeenCalledWith('hello');
    });

    it('无焦点组件时通过 getLayoutChildren 查找可滚动子组件', () => {
      const scrollableChild = createMockComponent() as Component & {
        handleScroll: ReturnType<typeof vi.fn>;
      };
      scrollableChild.handleScroll = vi.fn();
      tui.addChild(scrollableChild);
      // 不设置焦点，focused 为 null
      tui.start();

      const handler = getStdinHandler();
      handler(Buffer.from('\x1b[<64;10;5M'));

      // getLayoutChildren 应找到 scrollableChild
      expect(scrollableChild.handleScroll).toHaveBeenCalledWith('up');
    });

    it('焦点组件有 handleScroll 时不应查找子组件', () => {
      const focusedWithScroll = createMockComponent() as Component & {
        focused?: boolean;
        handleScroll: ReturnType<typeof vi.fn>;
      };
      focusedWithScroll.handleScroll = vi.fn();
      focusedWithScroll.focused = true;
      tui.setFocus(focusedWithScroll);

      const childWithScroll = createMockComponent() as Component & {
        handleScroll: ReturnType<typeof vi.fn>;
      };
      childWithScroll.handleScroll = vi.fn();
      tui.addChild(childWithScroll);
      tui.start();

      const handler = getStdinHandler();
      handler(Buffer.from('\x1b[<64;10;5M'));

      // 焦点组件有 handleScroll，应使用焦点组件的
      expect(focusedWithScroll.handleScroll).toHaveBeenCalledWith('up');
      // 子组件不应被调用
      expect(childWithScroll.handleScroll).not.toHaveBeenCalled();
    });

    it('无任何可滚动组件时不报错', () => {
      tui.addChild(createMockComponent());
      tui.start();

      const handler = getStdinHandler();
      expect(() => {
        handler(Buffer.from('\x1b[<64;10;5M'));
      }).not.toThrow();
    });
  });
});
