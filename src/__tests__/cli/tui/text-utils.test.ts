/**
 * text-utils 单元测试
 *
 * 覆盖以下三个纯函数：
 * - visibleWidth: 计算字符串在终端中的可见宽度
 * - truncateToWidth: 按可见宽度截断字符串，保留 ANSI 颜色完整性
 * - wrapTextWithAnsi: 按终端宽度换行，保留 ANSI 颜色
 */
import { describe, expect, it } from 'vitest';
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@/cli/tui/text-utils';

// ---------------------------------------------------------------------------
// visibleWidth
// ---------------------------------------------------------------------------
describe('visibleWidth', () => {
  it('空字符串宽度为 0', () => {
    expect(visibleWidth('')).toBe(0);
  });

  it('普通 ASCII 文本宽度等于字符数', () => {
    expect(visibleWidth('Hello')).toBe(5);
    expect(visibleWidth('abc123')).toBe(6);
    expect(visibleWidth(' ')).toBe(1);
  });

  it('ANSI 转义序列不计入宽度', () => {
    expect(visibleWidth('\x1b[31m')).toBe(0);
    expect(visibleWidth('\x1b[1;32m')).toBe(0);
    expect(visibleWidth('\x1b[48;5;196m')).toBe(0);
    expect(visibleWidth('\x1b[0m')).toBe(0);
    // ANSI + 文本
    expect(visibleWidth('\x1b[31mHello\x1b[0m')).toBe(5);
    expect(visibleWidth('\x1b[1;32mBold Green\x1b[0m')).toBe(10);
    // 多个连续 ANSI 序列
    expect(visibleWidth('\x1b[31m\x1b[1mBold Red\x1b[0m')).toBe(8);
  });

  it('CJK 全角字符计为 2', () => {
    expect(visibleWidth('中文')).toBe(4);
    expect(visibleWidth('中')).toBe(2);
    expect(visibleWidth('测试')).toBe(4);
    // 混合 CJK 和 ASCII
    expect(visibleWidth('Hello世界')).toBe(9); // 5 + 4
    expect(visibleWidth('你好 World')).toBe(10); // 4 + 1 + 5
  });

  it('零宽字符计为 0', () => {
    // 组合变音符
    expect(visibleWidth('A\u0308')).toBe(1); // A + combining diaeresis
    expect(visibleWidth('a\u0300')).toBe(1); // a + combining grave
    // 零宽空格
    expect(visibleWidth('\u200b')).toBe(0);
    // 零宽连接符
    expect(visibleWidth('\u200d')).toBe(0);
    // 变体选择器
    // U+FE0F 是 \u{FE0F} (Variation Selector-16)
    expect(visibleWidth('\u{FE0F}')).toBe(0);
    // 混合
    expect(visibleWidth('A\u0308B')).toBe(2);
  });

  it('控制字符计为 0', () => {
    // 控制字符 < 32
    expect(visibleWidth('\n')).toBe(0);
    expect(visibleWidth('\t')).toBe(0);
    expect(visibleWidth('\r')).toBe(0);
    expect(visibleWidth('\x00')).toBe(0);
    expect(visibleWidth('\x1b')).toBe(0); // ESC 字符（不是 ANSI 序列）
    // DEL (0x7f)
    expect(visibleWidth('\x7f')).toBe(0);
    // 混合控制字符和普通文本
    expect(visibleWidth('He\nllo')).toBe(5);
  });

  it('混合 ANSI、CJK、ASCII 和零宽字符', () => {
    const mixed = '\x1b[31mHello \u4e2d\u6587\x1b[0m\u0308';
    // plain: 'Hello 中文' + combining diaeresis
    // H e l l o  中 文 ̈
    // 1+1+1+1+1+1+2+2+0 = 10
    expect(visibleWidth(mixed)).toBe(10);
  });

  it('非 BMP 字符（代理对）不抛出异常', () => {
    // 😀 U+1F600, eastAsianWidth 返回具体值
    expect(visibleWidth('\u{1F600}')).toBeGreaterThanOrEqual(0);
    // 非 BMP + 零宽修饰符
    expect(visibleWidth('\u{1F600}\u{1F3FB}')).toBeGreaterThanOrEqual(0);
  });

  it('空字符串安全处理', () => {
    expect(visibleWidth('')).toBe(0);
    // 只有 ANSI
    expect(visibleWidth('\x1b[31m\x1b[0m')).toBe(0);
    // 只有控制字符
    expect(visibleWidth('\n\t\r')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// truncateToWidth
// ---------------------------------------------------------------------------
describe('truncateToWidth', () => {
  it('文本短于 maxWidth 时不截断', () => {
    expect(truncateToWidth('Hi', 10)).toBe('Hi');
    expect(truncateToWidth('Hello', 5)).toBe('Hello');
  });

  it('文本长度等于 maxWidth 时不截断', () => {
    expect(truncateToWidth('Hello', 5)).toBe('Hello');
  });

  it('文本长于 maxWidth 时截断并添加省略号', () => {
    expect(truncateToWidth('Hello World', 5)).toBe('He...');
    expect(truncateToWidth('Hello', 2)).toBe('...');
  });

  it('maxWidth 为 0 时返回空字符串', () => {
    expect(truncateToWidth('Hello', 0)).toBe('');
  });

  it('maxWidth 为负数时返回空字符串', () => {
    expect(truncateToWidth('Hello', -1)).toBe('');
  });

  it('maxWidth 为 Infinity 时返回原文本', () => {
    expect(truncateToWidth('Hello World', Infinity)).toBe('Hello World');
  });

  it('包含 ANSI 颜色时截断并保留颜色完整性', () => {
    // `\x1b[31mHello\x1b[0m` visibleWidth=5, maxWidth=3
    // targetWidth = 3 - 3 = 0 -> 只返回省略号
    const result = truncateToWidth('\x1b[31mHello\x1b[0m', 3);
    expect(result).toBe('...');
  });

  it('包含 ANSI 颜色且 maxWidth 足够大时保留颜色', () => {
    // `\x1b[31mHello\x1b[0m` visibleWidth=5, maxWidth=8
    // visibleWidth=5 <= 8, 不截断
    const result = truncateToWidth('\x1b[31mHello\x1b[0m', 8);
    expect(result).toBe('\x1b[31mHello\x1b[0m');
  });

  it('截断在可见字符处，保留 ANSI 序列', () => {
    // '\x1b[31mHello World\x1b[0m' visibleWidth=11, maxWidth=6
    // targetWidth = 6-3 = 3, 截断前 3 个可见字符
    const result = truncateToWidth('\x1b[31mHello World\x1b[0m', 6);
    expect(result).toBe('\x1b[31mHel...');
  });

  it('自定义省略号', () => {
    expect(truncateToWidth('Hello World', 5, '>>')).toBe('Hel>>');
  });

  it('自定义省略号为空字符串', () => {
    expect(truncateToWidth('Hello World', 5, '')).toBe('Hello');
  });

  it('targetWidth <= 0 时只返回省略号', () => {
    // 'Hello' visibleWidth=5, maxWidth=2, ellipsis='...' visibleWidth=3
    // targetWidth = 2-3 = -1 <= 0 -> 只返回省略号
    expect(truncateToWidth('Hello', 2)).toBe('...');
    expect(truncateToWidth('测试', 1)).toBe('...');
  });

  it('截断位置在 CJK 字符中间时正确处理', () => {
    // '中文测试' visibleWidth=8, maxWidth=5
    // targetWidth = 5-3=2
    // '中' width 2 <= 2, 保留
    // '文' width 2, current 2+2=4 > 2, 截断
    expect(truncateToWidth('中文测试', 5)).toBe('中...');
  });

  it('截断位置恰好在一个 CJK 字符后', () => {
    // '中文测试' visibleWidth=8, maxWidth=5, ellipsis='.'
    // targetWidth = 5-1=4
    // '中'(2) + '文'(2) = 4 <= 4
    // '测'(2), 4+2=6 > 4, 截断
    expect(truncateToWidth('中文测试', 5, '.')).toBe('中文.');
  });

  it('截断位置在 ANSI 序列边界', () => {
    // '\x1b[31mHelloWorld\x1b[0m' visibleWidth=10, maxWidth=6
    // targetWidth=3, 截断后 '\x1b[31mHel...'
    // 验证 ANSI 序列在结果中完整保留
    const result = truncateToWidth('\x1b[31mHelloWorld\x1b[0m', 6);
    expect(result).toContain('\x1b[31m');
  });

  it('文本只包含 ANSI 序列时返回原文本', () => {
    const ansiOnly = '\x1b[31m\x1b[0m';
    expect(truncateToWidth(ansiOnly, 10)).toBe(ansiOnly);
    expect(truncateToWidth(ansiOnly, 0)).toBe('');
  });

  it('空字符串返回空字符串', () => {
    expect(truncateToWidth('', 10)).toBe('');
  });

  it('控制字符和零宽字符不消耗宽度', () => {
    // 控制字符不占用宽度，在截断边界处能被正确保留
    // 'AB\nCDEFG' visibleWidth=7 (A=1, B=1, \n=0, C=1, D=1, E=1, F=1, G=1)
    // maxWidth=6, targetWidth=3, 截取 'AB\nC'
    const text = 'AB\nCDEFG';
    expect(truncateToWidth(text, 10)).toBe(text);
    expect(truncateToWidth(text, 6)).toBe('AB\nC...');

    // 零宽字符也不占用宽度
    // 'AB\u0308CDEFG' visibleWidth=7 (A=1, B=1, \u0308=0, C=1, D=1, E=1, F=1, G=1)
    // maxWidth=5, targetWidth=2, 截取 'AB'
    const zwText = 'AB\u0308CDEFG';
    expect(truncateToWidth(zwText, 5)).toBe('AB...');

    // 零宽字符在截断边界内被保留
    // maxWidth=6, targetWidth=3, 截取 'AB\u0308C'
    expect(truncateToWidth(zwText, 6)).toBe('AB\u0308C...');
  });

  it('截断包含 CJK 与 ANSI 混合文本', () => {
    // '\x1b[31m中文测试\x1b[0m' visibleWidth=8, maxWidth=5
    // targetWidth=5-3=2
    // '中' width=2 <= 2, 保留
    const result = truncateToWidth('\x1b[31m中文测试\x1b[0m', 5);
    expect(result).toBe('\x1b[31m中...');
  });

  it('Infinity 大小时不截断包含 CJK 的文本', () => {
    expect(truncateToWidth('中文', Infinity)).toBe('中文');
  });
});

// ---------------------------------------------------------------------------
// wrapTextWithAnsi
// ---------------------------------------------------------------------------
describe('wrapTextWithAnsi', () => {
  it('短文本不换行', () => {
    expect(wrapTextWithAnsi('Hello', 10)).toEqual(['Hello']);
  });

  it('文本长度正好等于宽度时不换行', () => {
    expect(wrapTextWithAnsi('Hello', 5)).toEqual(['Hello']);
  });

  it('长文本按宽度换行', () => {
    expect(wrapTextWithAnsi('HelloWorld', 5)).toEqual(['Hello', 'World']);
  });

  it('宽度 <= 0 时返回空数组', () => {
    expect(wrapTextWithAnsi('Hello', 0)).toEqual([]);
    expect(wrapTextWithAnsi('Hello', -1)).toEqual([]);
  });

  it('空字符串返回 [""]', () => {
    expect(wrapTextWithAnsi('', 10)).toEqual(['']);
  });

  it('多段落（含换行符）正确处理', () => {
    expect(wrapTextWithAnsi('Hello\nWorld', 10)).toEqual(['Hello', 'World']);
  });

  it('多段落中每段独立换行', () => {
    expect(wrapTextWithAnsi('HelloWorld\nABC', 5)).toEqual(['Hello', 'World', 'ABC']);
  });

  it('空段落保留为空行', () => {
    expect(wrapTextWithAnsi('Hello\n\nWorld', 10)).toEqual(['Hello', '', 'World']);
  });

  it('包含 ANSI 颜色的文本换行后颜色保留', () => {
    // '\x1b[31mHello World\x1b[0m' visibleWidth=11, 按 width=5 换行
    // 每行填满 5 个可见字符后换行，新行用 activeAnsi='\x1b[31m' 恢复颜色
    const result = wrapTextWithAnsi('\x1b[31mHello World\x1b[0m', 5);
    expect(result).toEqual(['\x1b[31mHello', '\x1b[31m Worl', '\x1b[31md\x1b[0m']);
  });

  it('ANSI 颜色跨多行 wrap 后每行颜色完整', () => {
    const result = wrapTextWithAnsi('\x1b[32mABCDEF\x1b[0m', 3);
    expect(result).toEqual(['\x1b[32mABC', '\x1b[32mDEF\x1b[0m']);
  });

  it('多个 ANSI 序列切换颜色时正确恢复', () => {
    // 红色、绿色交替
    const text = '\x1b[31mRed\x1b[32mGreen\x1b[0m';
    const result = wrapTextWithAnsi(text, 4);
    // visibleWidth: Red=3, Green=5, 总 8
    // 第一行: 到第4个可见字符时换行
    // 从 \x1b[31mRed 开始, 'R'=1, 'e'=1, 'd'=1 -> 共3, 继续
    // 'G'=1, 3+1=4 <=4, currentLine='\x1b[31mRed\x1b[32mG', 注意 ANSI 序列的累积
    // 'r'=1, 4+1=5 >4, wrap
    // 实际: '\x1b[31mRed\x1b[32mG' 是这一行（因为 ANSI 序列不计宽度）
    // wait, Green: \x1b[32m 在 G 之前，循环会处理
    // 让我重新仔细分析...
    //
    // i=0: ANSI match \x1b[31m, currentLine='\x1b[31m', activeAnsi='\x1b[31m', i=5
    // i=5: 'R' cp=82, charWidth=1, cw(0)+1=1 <=4, currentLine='\x1b[31mR', cw=1, i=6
    // i=6: 'e' cp=101, cw=1, charLine... cw(1)+1=2 <=4, 'Re', cw=2, i=7
    // i=7: 'd' cp=100, cw(2)+1=3 <=4, 'Red', cw=3, i=8
    // i=8: ANSI match \x1b[32m, currentLine='\x1b[31mRed\x1b[32m', activeAnsi='\x1b[32m', i=14
    // i=14: 'G' cp=71, cw(3)+1=4 <=4, 'Red\x1b[32mG', cw=4, i=15
    // i=15: 'r' cp=114, cw(4)+1=5 >4, push '\x1b[31mRed\x1b[32mG'
    //        currentLine = activeAnsi = '\x1b[32m', cw=0
    //        currentLine += 'r', currentLine='\x1b[32mr', cw=1, i=16
    // i=16: 'e' cp=101, cw(1)+1=2 <=4, '\x1b[32mre', cw=2, i=17
    // i=17: 'e' cp=101, cw(2)+1=3 <=4, '\x1b[32mree', cw=3, i=18
    // i=18: 'n' cp=110, cw(3)+1=4 <=4, '\x1b[32mreen', cw=4, i=19
    // i=19: ANSI match \x1b[0m, currentLine='\x1b[32mreen\x1b[0m', activeAnsi='\x1b[0m', i=23
    // End paragraph. push '\x1b[32mreen\x1b[0m'
    //
    // Result: ['\x1b[31mRed\x1b[32mG', '\x1b[32mreen\x1b[0m']
    expect(result).toEqual(['\x1b[31mRed\x1b[32mG', '\x1b[32mreen\x1b[0m']);
  });

  it('CJK 字符正确换行', () => {
    expect(wrapTextWithAnsi('中文测试', 4)).toEqual(['中文', '测试']);
  });

  it('混合 CJK 和 ASCII 换行', () => {
    expect(wrapTextWithAnsi('测A试B', 4)).toEqual(['测A', '试B']);
  });

  it('换行处正好是 ANSI 序列边界', () => {
    // 文本: 'AB\x1b[31mCD\x1b[0mEF', width=2
    // A=1,B=1 -> cw=2, 到达 C 时 cw+1=3 > 2, 触发换行
    // 但 \x1b[31m 在 C 之前遇到，已被追加到当前行
    const result = wrapTextWithAnsi('AB\x1b[31mCD\x1b[0mEF', 2);
    expect(result).toEqual(['AB\x1b[31m', '\x1b[31mCD\x1b[0m', '\x1b[0mEF']);
  });

  it('width=1 时每个可见字符单独一行', () => {
    // 'AB' width=1 -> 每个字符一行
    const result = wrapTextWithAnsi('AB', 1);
    expect(result).toEqual(['A', 'B']);
  });

  it('包含 ANSI 的文本 width=1', () => {
    // '\x1b[31mAB\x1b[0m' width=1
    // 'A' 正好填满 width (cw(0)+1 > 1 为 false)，留在第一行
    // 'B' 会使 cw(1)+1=2 > 1，触发换行
    const result = wrapTextWithAnsi('\x1b[31mAB\x1b[0m', 1);
    expect(result).toEqual(['\x1b[31mA', '\x1b[31mB\x1b[0m']);
  });

  it('零宽字符不触发换行', () => {
    // 'A\u0308B' width=5: A(1) + ◌̈(0) + B(1) = 2 可见宽度
    const text = 'A\u0308B';
    expect(wrapTextWithAnsi(text, 5)).toEqual([text]);
    expect(wrapTextWithAnsi(text, 1)).toEqual(['A\u0308', 'B']);
  });

  it('控制字符不触发换行', () => {
    expect(wrapTextWithAnsi('A\nB', 5)).toEqual(['A', 'B']);
  });

  it('宽度正好等于左边距时不换行', () => {
    // 'Hello' width=5, 刚好等于 5
    expect(wrapTextWithAnsi('Hello', 5)).toEqual(['Hello']);
  });

  it('单词刚好填满一行后下一个字符换行', () => {
    // 'ABCDE' width=3
    expect(wrapTextWithAnsi('ABCDE', 3)).toEqual(['ABC', 'DE']);
  });

  it('混合 ANSI、CJK 和 ASCII 换行', () => {
    const text = '\x1b[33m中A文B\x1b[0m';
    const result = wrapTextWithAnsi(text, 4);
    // '中'(2) + 'A'(1) = 3 <=4
    // '文'(2), 3+2=5 >4, wrap
    // new line: '\x1b[33m文B\x1b[0m' (文=2 + B=1 =3 <=4)
    expect(result).toEqual(['\x1b[33m中A', '\x1b[33m文B\x1b[0m']);
  });

  it('首字符就超过宽度时仍能换行', () => {
    // 首字符 width=2, width=1, 第一个字符立即触发换行产生空行
    const result = wrapTextWithAnsi('中文', 1);
    expect(result).toEqual(['', '中', '文']);
  });
});
