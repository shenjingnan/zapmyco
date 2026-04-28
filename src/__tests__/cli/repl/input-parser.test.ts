import { beforeEach, describe, expect, it } from 'vitest';
import { InputParser } from '../../../cli/repl/input-parser.js';

describe('InputParser', () => {
  let parser: InputParser;

  beforeEach(() => {
    parser = new InputParser();
  });

  describe('parse', () => {
    it('空行应返回 empty', () => {
      const result = parser.parse('');
      expect(result.kind).toBe('empty');
    });

    it('纯空白行应返回 empty', () => {
      const result = parser.parse('   ');
      expect(result.kind).toBe('empty');
    });

    it('以 / 开头的输入应解析为命令', () => {
      const result = parser.parse('/help');
      expect(result.kind).toBe('command');
      if (result.kind === 'command') {
        expect(result.name).toBe('help');
        expect(result.args).toEqual([]);
      }
    });

    it('带参数的命令应正确解析参数', () => {
      const result = parser.parse('/config show');
      expect(result.kind).toBe('command');
      if (result.kind === 'command') {
        expect(result.name).toBe('config');
        expect(result.args).toEqual(['show']);
      }
    });

    it('命令名应转为小写', () => {
      const result = parser.parse('/HELP');
      expect(result.kind).toBe('command');
      if (result.kind === 'command') {
        expect(result.name).toBe('help');
      }
    });

    it('支持引号包裹的参数（含空格）', () => {
      const result = parser.parse('/config get "llm.model"');
      expect(result.kind).toBe('command');
      if (result.kind === 'command') {
        expect(result.name).toBe('config');
        expect(result.args).toEqual(['get', 'llm.model']);
      }
    });

    it('普通文本应解析为 goal', () => {
      const result = parser.parse('帮我写个 hello world');
      expect(result.kind).toBe('goal');
      if (result.kind === 'goal') {
        expect(result.rawInput).toBe('帮我写个 hello world');
      }
    });

    it('以 \\ 结尾的行应返回 incomplete（多行续行）', () => {
      const result = parser.parse('第一行\\');
      expect(result.kind).toBe('incomplete');
      if (result.kind === 'incomplete') {
        expect(result.buffer).toBe('第一行');
      }
    });

    it('多行输入应正确拼接', () => {
      parser.parse('第一行\\');
      const result = parser.parse('第二行');
      expect(result.kind).toBe('goal');
      if (result.kind === 'goal') {
        expect(result.rawInput).toBe('第一行\n第二行');
      }
    });

    it('多行续行后接命令应清空 buffer 并解析命令', () => {
      parser.parse('一些文本\\');
      const result = parser.parse('/help');
      expect(result.kind).toBe('command');
      if (result.kind === 'command') {
        expect(result.name).toBe('help');
      }
    });

    it('只有 \\ 的行应返回 incomplete 且 buffer 为空字符串', () => {
      const result = parser.parse('\\');
      expect(result.kind).toBe('incomplete');
      if (result.kind === 'incomplete') {
        expect(result.buffer).toBe('');
      }
    });
  });

  describe('reset', () => {
    it('reset 后应清空缓冲区', () => {
      parser.parse('第一行\\');
      parser.reset();
      const result = parser.parse('全新输入');
      expect(result.kind).toBe('goal');
      if (result.kind === 'goal') {
        expect(result.rawInput).toBe('全新输入');
      }
    });
  });

  describe('getBuffer', () => {
    it('应返回当前缓冲内容', () => {
      expect(parser.getBuffer()).toBe('');
      parser.parse('abc\\');
      expect(parser.getBuffer()).toBe('abc');
    });
  });

  describe('边界情况', () => {
    it('Unicode 输入应正常处理', () => {
      const result = parser.parse('你好世界 🌍 测试');
      expect(result.kind).toBe('goal');
      if (result.kind === 'goal') {
        expect(result.rawInput).toBe('你好世界 🌍 测试');
      }
    });

    it('前导空白的目标输入应保留空白', () => {
      const result = parser.parse('   缩进的文本');
      expect(result.kind).toBe('goal');
      if (result.kind === 'goal') {
        expect(result.rawInput).toBe('   缩进的文本');
      }
    });

    it('仅 / 的输入应返回 empty', () => {
      const result = parser.parse('/');
      expect(result.kind).toBe('empty');
    });

    it('命令后无参数的多个空格应正确处理', () => {
      const result = parser.parse('/help   ');
      expect(result.kind).toBe('command');
      if (result.kind === 'command') {
        expect(result.name).toBe('help');
        expect(result.args).toEqual([]);
      }
    });
  });
});
