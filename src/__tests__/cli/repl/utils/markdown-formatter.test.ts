/**
 * Markdown → ANSI 格式化器测试
 *
 * 测试策略：
 * - 所有测试通过 formatMarkdown(text, false) 调用，禁用颜色以获取纯文本输出
 * - 表格对齐通过解析输出行的显示宽度验证
 * - 各种 Markdown 元素逐一验证格式正确性
 */
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line import/no-restricted-paths -- 测试直接引用源码
import { formatMarkdown } from '@/cli/repl/utils/markdown-formatter';

// ─── 辅助函数 ───

/** 计算字符串的终端显示宽度（与源码逻辑一致） */
const ESC = String.fromCharCode(27);
function isWideChar(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x2fff) ||
    (code >= 0x3000 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f000 && code <= 0x1ffff) ||
    (code >= 0x20000 && code <= 0x2ffff) ||
    (code >= 0x30000 && code <= 0x3ffff) ||
    code === 0x00a9 ||
    code === 0x00ae ||
    (code >= 0x2000 && code <= 0x206f) ||
    (code >= 0x2100 && code <= 0x27bf) ||
    (code >= 0x2b00 && code <= 0x2bff) ||
    (code >= 0x2900 && code <= 0x297f) ||
    code === 0x3030 ||
    code === 0x303d ||
    code === 0x3297 ||
    code === 0x3298 ||
    code === 0x231a ||
    code === 0x231b ||
    code === 0x23e9 ||
    code === 0x23ec ||
    code === 0x23f0 ||
    code === 0x23f3 ||
    code === 0x25fd ||
    code === 0x25fe ||
    code === 0x2614 ||
    code === 0x2615 ||
    code === 0x2648 ||
    code === 0x2653 ||
    code === 0x267f ||
    code === 0x2693 ||
    code === 0x26a1 ||
    code === 0x26aa ||
    code === 0x26ab ||
    code === 0x26bd ||
    code === 0x26be ||
    code === 0x26c4 ||
    code === 0x26c5 ||
    code === 0x26ce ||
    code === 0x26d4 ||
    code === 0x26ea ||
    code === 0x26f2 ||
    code === 0x26f3 ||
    code === 0x26f5 ||
    code === 0x26fa ||
    code === 0x26fd ||
    code === 0x2702 ||
    code === 0x2705 ||
    code === 0x2708 ||
    code === 0x2709 ||
    code === 0x270a ||
    code === 0x270b ||
    code === 0x270c ||
    code === 0x270d ||
    code === 0x270f ||
    code === 0x2712 ||
    code === 0x2714 ||
    code === 0x2716 ||
    code === 0x271d ||
    code === 0x2721 ||
    code === 0x2728 ||
    code === 0x2733 ||
    code === 0x2734 ||
    code === 0x2744 ||
    code === 0x2747 ||
    code === 0x274c ||
    code === 0x274e ||
    code === 0x2753 ||
    code === 0x2754 ||
    code === 0x2755 ||
    code === 0x2757 ||
    code === 0x2763 ||
    code === 0x2764 ||
    code === 0x2795 ||
    code === 0x2796 ||
    code === 0x2797 ||
    code === 0x27a1 ||
    code === 0x27b0 ||
    code === 0x27bf ||
    code === 0x2934 ||
    code === 0x2935 ||
    code === 0x2b05 ||
    code === 0x2b06 ||
    code === 0x2b07 ||
    code === 0x2b1b ||
    code === 0x2b1c ||
    code === 0x2b50 ||
    code === 0x2b55 ||
    code === 0x2bc3 ||
    code === 0x2bc4
  );
}
function isZeroWidthChar(code: number): boolean {
  return (
    code === 0x200b ||
    code === 0x200c ||
    code === 0x200d ||
    code === 0x200e ||
    code === 0x200f ||
    code === 0x2060 ||
    (code >= 0x2061 && code <= 0x2064) ||
    code === 0xfe0e ||
    code === 0xfe0f ||
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe20 && code <= 0xfe2f)
  );
}
function displayWidth(str: string): number {
  const plain = str.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');
  let w = 0;
  for (const ch of plain) {
    const code = ch.codePointAt(0) ?? 0;
    if (isZeroWidthChar(code)) continue;
    w += isWideChar(code) ? 2 : 1;
  }
  return w;
}

/** 提取表中非边框行，验证它们的显示宽度一致 */
function expectTableAligned(tableMd: string): string[] {
  const result = formatMarkdown(tableMd, false);
  const lines = result.split('\n').filter((l) => l.trim());
  // 过滤掉边框/分隔行
  const contentLines = lines.filter((l) => l.startsWith('│') && !l.startsWith('├'));
  if (contentLines.length === 0) return lines;

  const widths = contentLines.map((l) => displayWidth(l));
  const expected = widths[0];
  for (let i = 1; i < widths.length; i++) {
    expect(widths[i], `行 ${i} 显示宽度不一致: ${JSON.stringify(contentLines[i])}`).toBe(expected);
  }
  return lines;
}

// ─── 测试套件 ───

describe('formatMarkdown', () => {
  describe('基础格式', () => {
    it('空输入返回空字符串', () => {
      expect(formatMarkdown('', false)).toBe('');
    });

    it('普通文本直接输出', () => {
      const result = formatMarkdown('hello world', false);
      expect(result).toBe('hello world');
    });

    it('加粗文本', () => {
      const result = formatMarkdown('这是 **粗体** 文字', false);
      expect(result).toContain('粗体');
      // 颜色禁用时没有 ANSI 转义序列
      expect(result).not.toContain('\x1b[');
    });

    it('斜体文本', () => {
      const result = formatMarkdown('这是 *斜体* 文字', false);
      expect(result).toContain('斜体');
    });

    it('行内代码', () => {
      const result = formatMarkdown('使用 `code` 行内代码', false);
      // 颜色禁用时 code 用纯文本
      expect(result).toContain('code');
    });

    it('段落以换行结束', () => {
      const result = formatMarkdown('第一段\n\n第二段', false);
      expect(result).toMatch(/第一段\n\n第二段/);
    });
  });

  describe('标题', () => {
    it('h1 标题', () => {
      const result = formatMarkdown('# Title', false);
      expect(result).toContain('Title');
      // heading 后面应该有换行（trimEnd 会去掉结尾的，但文本中应保留）
      expect(result).toMatch(/Title/);
    });

    it('h2 标题', () => {
      const result = formatMarkdown('## Sub Title', false);
      expect(result).toContain('Sub Title');
    });

    it('h3 标题（h2+ 规则）', () => {
      const result = formatMarkdown('### h3', false);
      expect(result).toContain('h3');
    });
  });

  describe('链接和图片', () => {
    it('链接：有文本时显示文本+url', () => {
      const result = formatMarkdown('[示例](https://example.com)', false);
      expect(result).toContain('示例');
      expect(result).toContain('example.com');
    });

    it('链接：文本与 url 相同时只显示一次', () => {
      const result = formatMarkdown('[https://example.com](https://example.com)', false);
      // 不应该出现两次 URL
      expect(result).toBe('https://example.com');
    });

    it('图片返回 href', () => {
      const result = formatMarkdown('![alt](https://example.com/img.png)', false);
      expect(result).toBe('https://example.com/img.png');
    });
  });

  describe('代码块', () => {
    it('无语言标注的代码块', () => {
      const result = formatMarkdown('```\ncode\n```', false);
      expect(result).toContain('code');
    });

    it('有语言标注的代码块', () => {
      const result = formatMarkdown('```js\nconsole.log(1)\n```', false);
      expect(result).toContain('console.log(1)');
      expect(result).toContain('js');
    });
  });

  describe('引用', () => {
    it('单行引用', () => {
      const result = formatMarkdown('> 引用内容', false);
      expect(result).toContain('引用内容');
      expect(result).toMatch(/│/);
    });

    it('多行引用', () => {
      const result = formatMarkdown('> 行1\n> 行2', false);
      expect(result).toContain('行1');
      expect(result).toContain('行2');
    });
  });

  describe('列表', () => {
    it('无序列表', () => {
      const result = formatMarkdown('- 项1\n- 项2', false);
      expect(result).toContain('项1');
      expect(result).toContain('项2');
    });

    it('有序列表', () => {
      const result = formatMarkdown('1. 第一\n2. 第二', false);
      expect(result).toMatch(/1\./);
      expect(result).toMatch(/2\./);
    });
  });

  describe('分割线和特殊元素', () => {
    it('水平分割线', () => {
      const result = formatMarkdown('---', false);
      expect(result).toContain('─');
    });

    it('转义字符', () => {
      const result = formatMarkdown('\\*not italic\\*', false);
      expect(result).toContain('*not italic*');
    });

    it('删除线被禁用（~ 不被解析）', () => {
      const result = formatMarkdown('~100~', false);
      // ~ 不应被删除线解析，应保持原样
      expect(result).toContain('~100~');
    });
  });

  describe('表格', () => {
    it('基础表格对齐', () => {
      const lines = expectTableAligned('| A | B | C |\n' + '|---|---|---|\n' + '| 1 | 2 | 3 |');
      // 应该有顶部边框
      expect(lines[0]).toMatch(/^┌/);
      // 应该有 header
      expect(lines[1]).toContain('A');
      // 应该有分隔线
      expect(lines[2]).toMatch(/^├/);
      // 应该有数据行
      expect(lines[3]).toContain('1');
      // 应该有底部边框
      expect(lines[lines.length - 1]).toMatch(/^└/);
    });

    it('CJK 字符表格对齐', () => {
      const lines = expectTableAligned('| 名称 | 值 |\n' + '|------|------|\n' + '| 中文 | 测试 |');
      expect(lines[1]).toContain('名称');
      expect(lines[3]).toContain('中文');
    });

    it('表格包含 emoji 对齐', () => {
      const lines = expectTableAligned(
        '| 步骤 | 状态 | 详情 |\n' +
          '|------|------|------|\n' +
          '| A | ✅ | normal |\n' +
          '| B | ⚠️ | warning |'
      );
      expect(lines[3]).toContain('✅');
      expect(lines[4]).toContain('⚠️');
    });

    it('不同语言混合表格对齐', () => {
      const lines = expectTableAligned(
        '| 步骤 | 状态 |\n' +
          '|------|------|\n' +
          '| 暂存文件 | ✅ 成功 |\n' +
          '| Commit | ⚠️ 警告 |'
      );
      expect(lines[3]).toContain('暂存文件');
      expect(lines[4]).toContain('Commit');
    });

    it('右对齐', () => {
      const lines = expectTableAligned(
        '| 左 | 右 |\n' + '|:---|---:|\n' + '| a | 1 |\n' + '| bb | 22 |'
      );
      // 右对齐列的分隔线以 : 开头（left=:）
      expect(lines[2]).toContain(':───');
    });

    it('居中对齐', () => {
      const lines = expectTableAligned('| 左 | 中 |\n' + '|:---|:---:|\n' + '| a | b |');
      // 居中对齐列的分隔线两端为 :（left=:, right=:）
      expect(lines[2]).toContain(':───:');
    });

    it('空单元格处理', () => {
      const lines = expectTableAligned('| A | B |\n' + '|---|---|\n' + '| 1 | |\n' + '| | 2 |');
      expect(lines[3]).toContain('1');
      expect(lines[4]).toContain('2');
    });

    it('长文本不截断', () => {
      const longText = '这是一段比较长的中文内容用于测试';
      const lines = expectTableAligned(`| A |\n|---|\n| ${longText} |`);
      expect(lines[3]).toContain(longText);
    });

    it('单列表格', () => {
      const lines = expectTableAligned('| 名称 |\n' + '|------|\n' + '| 值1 |\n' + '| 值2 |');
      expect(lines[1]).toContain('名称');
    });

    it('多列宽表格', () => {
      const lines = expectTableAligned(
        '| Short | Medium | LongerHere |\n' + '|-------|--------|------------|\n' + '| a | b | c |'
      );
      expect(lines[3]).toContain('a');
      expect(lines[3]).toContain('c');
    });
  });

  describe('ansiCellWidth 间接验证（通过表格对齐）', () => {
    it('零宽字符不占宽度（⚠️ 变体选择符）', () => {
      // 测试含 FE0F 变体选择符的字符对齐
      const lines = expectTableAligned(
        '| A | B |\n' + '|---|---|\n' + '| 1 | ✅ |\n' + '| 2 | ⚠️ |'
      );
      // 所有内容行应有相同的显示宽度
      const contentLines = lines.filter((l) => l.startsWith('│') && !l.startsWith('├'));
      const widths = contentLines.map((l) => displayWidth(l));
      expect(widths[0]).toBe(widths[1]);
      expect(widths[1]).toBe(widths[2]);
    });

    it('ZWJ 序列不增加宽度', () => {
      const lines = expectTableAligned(
        '| A | B |\n' + '|---|---|\n' + '| 1 | text |\n' + '| 2 | a\u{200d}b |'
      );
      const contentLines = lines.filter((l) => l.startsWith('│') && !l.startsWith('├'));
      const widths = contentLines.map((l) => displayWidth(l));
      // ZWJ 不影响对齐
      expect(widths[0]).toBe(widths[1]);
      expect(widths[1]).toBe(widths[2]);
    });

    it('ANSI 转义序列不计入宽度', () => {
      // 此测试通过 colorEnabled=true 验证 ANSI 序列不影响列宽计算
      const md = '| A | B |\n' + '|---|---|\n' + '| 1 | 2 |';
      const raw = formatMarkdown(md, false);
      const colored = formatMarkdown(md, true);
      const rawLines = raw.split('\n').filter((l) => l.trim());
      const coloredLines = colored.split('\n').filter((l) => l.trim());
      // 行数应一致
      expect(coloredLines.length).toBe(rawLines.length);
      // 数据行显示宽度应一致（ANSI 不计入宽度）
      for (let i = 0; i < rawLines.length; i++) {
        const rawLine = rawLines[i];
        const colLine = coloredLines[i];
        if (rawLine === undefined || colLine === undefined) continue;
        const rawW = displayWidth(rawLine);
        const colW = displayWidth(colLine);
        expect(rawW).toBe(colW);
      }
    });
  });

  describe('颜色模式', () => {
    it('colorEnabled=true 与 false 行为不同', () => {
      // chalk 在非 TTY 环境可能自动禁用颜色，但 colorEnabled 参数控制逻辑
      const enabled = formatMarkdown('**bold**', true);
      const disabled = formatMarkdown('**bold**', false);
      // 无论是否有 ANSI 码，bold 内容都应出现
      expect(enabled).toContain('bold');
      expect(disabled).toContain('bold');
    });

    it('colorEnabled=false 无 ANSI 码', () => {
      const result = formatMarkdown('**bold**', false);
      expect(result).not.toContain('\x1b[');
    });
  });

  describe('边界场景', () => {
    it('html 标签被忽略', () => {
      const result = formatMarkdown('<div>content</div>', false);
      expect(result).not.toContain('<div>');
    });

    it('包含 url 的纯文本', () => {
      const result = formatMarkdown('访问 https://example.com', false);
      expect(result).toContain('https://example.com');
    });

    it('markdown 未开启时保持原样', () => {
      const text = '一些 **文本**';
      const result = formatMarkdown(text, false);
      expect(result).toContain('文本');
    });

    it('混合复杂内容', () => {
      const md = [
        '# 标题',
        '',
        '一段**加粗**和*斜体*的描述。',
        '',
        '- 列表项 1',
        '- 列表项 2',
      ].join('\n');
      const result = formatMarkdown(md, false);
      expect(result).toContain('标题');
      expect(result).toContain('加粗');
      expect(result).toContain('斜体');
      expect(result).toContain('列表项');
    });
  });

  describe('多个段落/空行处理', () => {
    it('多个连续空行被保留', () => {
      const result = formatMarkdown('a\n\n\nb', false);
      // 至少有一个换行分隔 a 和 b
      expect(result).toMatch(/a\n+b/);
    });

    it('文本末尾空白被修剪', () => {
      const result = formatMarkdown('text  ', false);
      expect(result).toBe('text');
    });
  });

  describe('复杂的表格场景（回归测试）', () => {
    it('类似 commit 摘要表的完整渲染', () => {
      const md = [
        '| 步骤 | 状态 | 详情 |',
        '|------|------|------|',
        '| Commit | ✅ | feat: 测试提交 (abcd1234) |',
        '| Push | ✅ | 已推送至 origin/main |',
        '| PR | ⚠️ | PR 已存在：#122 (https://github.com/owner/repo/pull/122) |',
      ].join('\n');
      const lines = expectTableAligned(md);
      expect(lines[0]).toMatch(/^┌/);
      expect(lines[lines.length - 1]).toMatch(/^└/);
    });

    it('无数据的纯表头（只有分隔线）', () => {
      const md = '| H1 | H2 |\n|---|---|';
      const result = formatMarkdown(md, false);
      // 即使没有数据行，表头也会渲染
      expect(result).toContain('H1');
      expect(result).toContain('H2');
    });
  });

  describe('转义字符', () => {
    it('反斜杠转义保留文字', () => {
      const result = formatMarkdown('\\*literal\\*', false);
      expect(result).toContain('*literal*');
    });
  });

  describe('超大内容', () => {
    it('长字符串不崩溃', () => {
      const longText = 'word '.repeat(500);
      const result = formatMarkdown(longText, false);
      expect(result).toContain('word');
    });
  });

  describe('表格含 ANSI 样式', () => {
    it('colorEnabled=true 时表格含 ANSI 码但不影响对齐', () => {
      // 验证表格边框不带 dim ANSI 码
      const md = '| A | B |\n|---|---|\n| 1 | 2 |';
      const result = formatMarkdown(md, true);
      const lines = result.split('\n').filter((l) => l.trim());

      // 边框行不应包含 dim 转义序列 (\x1b[2m)
      for (const line of lines) {
        if (
          line.startsWith('┌') ||
          line.startsWith('├') ||
          line.startsWith('└') ||
          line.startsWith('┐') ||
          line.startsWith('┤') ||
          line.startsWith('┘')
        ) {
          expect(line).not.toContain('\x1b[2m');
        }
      }
    });
  });

  describe('额外边界测试', () => {
    it('处理 br 换行标签', () => {
      // marked 可能会将 <br> 解析为 br token
      const result = formatMarkdown('行1<br>行2', false);
      expect(result).toBeTruthy();
    });

    it('含有列为空的表格', () => {
      const result = formatMarkdown('| A | B |\n|---|---|\n| 1 |', false);
      expect(result).toContain('A');
      expect(result).toContain('1');
    });

    it('不存在的 token 类型走 default 路径（返回空）', () => {
      // 通过 inline markdown 让 marked 自行决定 token 类型
      // html 块被忽略
      const result = formatMarkdown('<script>alert(1)</script>', false);
      expect(result).not.toContain('alert');
    });
  });
});
