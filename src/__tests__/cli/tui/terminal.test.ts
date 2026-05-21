/**
 * ProcessTerminal 单元测试
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessTerminal } from '@/cli/tui/terminal';

describe('ProcessTerminal', () => {
  let terminal: ProcessTerminal;

  beforeEach(() => {
    // 确保 process.stdin 有 setRawMode 方法
    if (typeof (process.stdin as any).setRawMode !== 'function') {
      (process.stdin as any).setRawMode = vi.fn();
    }
    if ((process.stdin as any).isTTY === undefined) {
      (process.stdin as any).isTTY = true;
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
      const origRows = (process.stdout as any).rows;
      const origColumns = (process.stdout as any).columns;
      (process.stdout as any).rows = undefined;
      (process.stdout as any).columns = undefined;
      // 重新创建 terminal 以读取新值
      const t = new ProcessTerminal();
      expect(t.rows).toBe(24);
      expect(t.columns).toBe(80);
      (process.stdout as any).rows = origRows;
      (process.stdout as any).columns = origColumns;
    });
  });

  describe('raw mode', () => {
    it('stdin.isTTY 为 true 时应启用 raw mode', () => {
      const spy = vi.spyOn(process.stdin, 'setRawMode').mockImplementation(() => {});
      terminal.enableRawMode();
      expect(spy).toHaveBeenCalledWith(true);
      spy.mockRestore();
    });

    it('stdin.isTTY 为 false 时应跳过 setRawMode', () => {
      const origIsTTY = (process.stdin as any).isTTY;
      (process.stdin as any).isTTY = false;
      const spy = vi.spyOn(process.stdin, 'setRawMode');
      terminal.enableRawMode();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
      (process.stdin as any).isTTY = origIsTTY;
    });

    it('disableRawMode 应调用 setRawMode(false)', () => {
      const spy = vi.spyOn(process.stdin, 'setRawMode').mockImplementation(() => {});
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
    it('应禁用 raw mode 并移除 resize 监听', () => {
      const rawSpy = vi.spyOn(process.stdin, 'setRawMode').mockImplementation(() => {});
      const removeSpy = vi.spyOn(process.stdout, 'removeListener');
      terminal.onResize(() => {});
      terminal.destroy();
      expect(rawSpy).toHaveBeenCalledWith(false);
      expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
      rawSpy.mockRestore();
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
