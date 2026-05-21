/**
 * ProcessTerminal 单元测试
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTER_ALT_SCREEN, EXIT_ALT_SCREEN } from '@/cli/tui/dec';
import { ProcessTerminal } from '@/cli/tui/terminal';

describe('ProcessTerminal', () => {
  let terminal: ProcessTerminal;

  /** 测试辅助类型，用于模拟 process.stdin 的 Node.js 类型缺失属性 */
  const testStdin = () =>
    process.stdin as unknown as { setRawMode: ReturnType<typeof vi.fn>; isTTY: boolean };
  /** 测试辅助类型，用于模拟 process.stdout 的 Node.js 类型缺失属性 */
  const testStdout = () =>
    process.stdout as unknown as { rows: number | undefined; columns: number | undefined };

  beforeEach(() => {
    // 确保 process.stdin 有 setRawMode 方法
    if (typeof testStdin().setRawMode !== 'function') {
      testStdin().setRawMode = vi.fn();
    }
    if (testStdin().isTTY === undefined) {
      testStdin().isTTY = true;
    }
    terminal = new ProcessTerminal();
  });

  describe('rows / columns', () => {
    it('应返回 process.stdout 的行列数', () => {
      expect(terminal.rows).toBeGreaterThan(0);
      expect(terminal.columns).toBeGreaterThan(0);
    });

    it('process.stdout 无 rows 时应返回默认值', () => {
      // 模拟 process.stdout 没有 rows/columns 的情况
      const origRows = testStdout().rows;
      const origColumns = testStdout().columns;
      testStdout().rows = undefined;
      testStdout().columns = undefined;
      // 重新创建 terminal 以读取新值
      const t = new ProcessTerminal();
      expect(t.rows).toBe(24);
      expect(t.columns).toBe(80);
      testStdout().rows = origRows;
      testStdout().columns = origColumns;
    });
  });

  describe('raw mode', () => {
    it('stdin.isTTY 为 true 时应启用 raw mode 并进入 alt screen', () => {
      const rawSpy = vi.spyOn(process.stdin, 'setRawMode').mockImplementation(() => process.stdin);
      const writeSpy = vi.spyOn(terminal, 'write');
      terminal.enableRawMode();
      expect(rawSpy).toHaveBeenCalledWith(true);
      expect(writeSpy).toHaveBeenCalledWith(ENTER_ALT_SCREEN);
      rawSpy.mockRestore();
      writeSpy.mockRestore();
    });

    it('stdin.isTTY 为 false 时应跳过 setRawMode', () => {
      const origIsTTY = testStdin().isTTY;
      testStdin().isTTY = false;
      const spy = vi.spyOn(process.stdin, 'setRawMode');
      terminal.enableRawMode();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
      testStdin().isTTY = origIsTTY;
    });

    it('disableRawMode 应调用 setRawMode(false)', () => {
      const spy = vi.spyOn(process.stdin, 'setRawMode').mockImplementation(() => process.stdin);
      terminal.disableRawMode();
      expect(spy).toHaveBeenCalledWith(false);
      spy.mockRestore();
    });
  });

  describe('write', () => {
    it('应写入数据到 stdout', () => {
      const spy = vi.spyOn(process.stdout, 'write');
      terminal.write('test');
      expect(spy).toHaveBeenCalledWith('test');
      spy.mockRestore();
    });
  });

  describe('clear', () => {
    it('应发送清屏转义序列并定位光标到起点', () => {
      const spy = vi.spyOn(terminal, 'write');
      const cursorSpy = vi.spyOn(terminal, 'cursorTo');
      terminal.clear();
      expect(spy).toHaveBeenCalledWith('\x1b[2J\x1b[3J');
      expect(cursorSpy).toHaveBeenCalledWith(0, 0);
      spy.mockRestore();
      cursorSpy.mockRestore();
    });
  });

  describe('cursorTo', () => {
    it('应在指定列行显示光标', () => {
      // 只是验证不报错
      expect(() => terminal.cursorTo(5, 10)).not.toThrow();
    });
  });

  describe('onResize', () => {
    it('应注册 resize 回调', () => {
      const spy = vi.spyOn(process.stdout, 'on');
      const cb = () => {};
      terminal.onResize(cb);
      expect(spy).toHaveBeenCalledWith('resize', expect.any(Function));
      spy.mockRestore();
    });

    it('应支持注册多个回调', () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      terminal.onResize(cb1);
      terminal.onResize(cb2);
      // 触发 resize
      process.stdout.emit('resize');
      expect(cb1).toHaveBeenCalled();
      expect(cb2).toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('应禁用 raw mode、退出 alt screen 并移除 resize 监听', () => {
      const rawSpy = vi.spyOn(process.stdin, 'setRawMode').mockImplementation(() => process.stdin);
      const writeSpy = vi.spyOn(terminal, 'write');
      const removeSpy = vi.spyOn(process.stdout, 'removeListener');
      terminal.onResize(() => {});
      terminal.destroy();
      expect(rawSpy).toHaveBeenCalledWith(false);
      expect(writeSpy).toHaveBeenCalledWith(EXIT_ALT_SCREEN);
      expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
      rawSpy.mockRestore();
      writeSpy.mockRestore();
      removeSpy.mockRestore();
    });

    it('无 resize 绑定时应安全执行', () => {
      expect(() => terminal.destroy()).not.toThrow();
    });

    it('destroy 后 resize 回调不应再触发', () => {
      const cb = vi.fn();
      terminal.onResize(cb);
      terminal.destroy();
      process.stdout.emit('resize');
      expect(cb).not.toHaveBeenCalled();
    });
  });
});
