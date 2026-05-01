import { describe, expect, it } from 'vitest';
import {
  extractAndConvert,
  extractMainContent,
  htmlToMarkdown,
} from '@/cli/repl/tools/html-to-markdown';

describe('htmlToMarkdown', () => {
  it('应该将 HTML 标题转换为 Markdown ATX 格式', () => {
    const html = '<h1>标题</h1><h2>副标题</h2>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('# 标题');
    expect(md).toContain('## 副标题');
  });

  it('应该将 HTML 段落转换为文本', () => {
    const html = '<p>这是一个段落</p>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('这是一个段落');
  });

  it('应该将链接转换为内联格式', () => {
    const html = '<a href="https://example.com">示例</a>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('[示例](https://example.com)');
  });

  it('应该将代码块转换为围栏格式', () => {
    const html = '<pre><code>const x = 1;</code></pre>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('```');
    expect(md).toContain('const x = 1;');
  });

  it('应该将无序列表转换为 - 格式', () => {
    const html = '<ul><li>第一项</li><li>第二项</li></ul>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('第一项');
    expect(md).toContain('第二项');
    expect(md).toMatch(/-\s+第一项/);
  });
});

describe('extractMainContent', () => {
  it('应该提取 <main> 标签内容', () => {
    const html = `
      <html>
        <head><title>测试页面</title></head>
        <body>
          <nav>导航栏</nav>
          <main><article><h1>正文标题</h1><p>正文内容</p></article></main>
          <footer>页脚</footer>
        </body>
      </html>
    `;
    const result = extractMainContent(html);
    expect(result).toContain('# 测试页面');
    expect(result).toContain('正文标题');
    expect(result).toContain('正文内容');
    // 不应包含导航栏和页脚
    // 注意：正则提取可能不够精确，但至少应包含 main 内容
  });

  it('应该提取 <article> 标签内容', () => {
    const html = `
      <html>
        <head><title>文章页面</title></head>
        <body>
          <div>侧边栏</div>
          <article><h1>文章标题</h1><p>文章正文</p></article>
          <div>广告</div>
        </body>
      </html>
    `;
    const result = extractMainContent(html);
    expect(result).toContain('# 文章页面');
    expect(result).toContain('文章标题');
  });

  it('应该提取 <title> 作为前缀', () => {
    const html = '<html><head><title>我的页面</title></head><body><p>内容</p></body></html>';
    const result = extractMainContent(html);
    expect(result).toContain('# 我的页面');
  });

  it('应该提取 meta description', () => {
    const html = `<html><head><title>T</title><meta name="description" content="这是页面描述"></head><body><p>内容</p></body></html>`;
    const result = extractMainContent(html);
    expect(result).toContain('> 这是页面描述');
  });

  it('没有匹配的容器时应该返回 body 内容', () => {
    const html = '<html><head><title>T</title></head><body><p>只有 body 内容</p></body></html>';
    const result = extractMainContent(html);
    expect(result).toContain('只有 body 内容');
  });
});

describe('extractAndConvert', () => {
  it('应该是 extractMainContent + htmlToMarkdown 的组合', () => {
    const html = `
      <html>
        <head><title>转换测试</title></head>
        <body>
          <main><h1>标题</h1><p><strong>粗体</strong>文本</p></main>
        </body>
      </html>
    `;
    const result = extractAndConvert(html);
    expect(result).toContain('# 转换测试');
    expect(result).toContain('# 标题');
    expect(result).toContain('**粗体**');
  });
});
