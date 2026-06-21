import type { Meta, StoryObj } from '@storybook/react';
import { MarkdownRenderer } from '../components/MarkdownRenderer';

const meta: Meta<typeof MarkdownRenderer> = {
  title: 'Components/MarkdownRenderer',
  component: MarkdownRenderer,
};

export default meta;
type Story = StoryObj<typeof MarkdownRenderer>;

export const PlainText: Story = {
  name: '纯文本',
  args: {
    content: '这是一段普通文本。\n\n支持多段落显示。\n\n这是第三段内容。',
  },
};

export const InlineCode: Story = {
  name: '内联代码',
  args: {
    content: '你可以使用 `npm install` 安装依赖，或者使用 `cargo build` 编译 Rust 项目。',
  },
};

export const CodeBlock: Story = {
  name: '代码块',
  args: {
    content: [
      '```rust',
      'fn main() {',
      '    println!("Hello, World!");',
      '    let x = 42;',
      '    println!("x = {}", x);',
      '}',
      '```',
    ].join('\n'),
  },
};

export const Link: Story = {
  name: '链接',
  args: {
    content:
      '访问 [GitHub](https://github.com) 了解更多信息，或查看 [文档](https://docs.example.com)。',
  },
};

export const Table: Story = {
  name: '表格',
  args: {
    content: [
      '| 功能 | 状态 | 优先级 |',
      '|------|------|--------|',
      '| 聊天 | ✅ | 高 |',
      '| 工具调用 | ✅ | 高 |',
      '| Web 界面 | ✅ | 中 |',
      '| 移动端 | ❌ | 低 |',
    ].join('\n'),
  },
};

export const TableWithLineBreaks: Story = {
  name: '表格（换行内容）',
  args: {
    content: [
      '| 项目 | 描述 |',
      '|------|------|',
      '| ZapMyCo | 基于 AI 的命令行工具 <br>支持交互式 LLM 聊天 <br>基于 Rust 实现 |',
      '| Storybook | 组件开发环境 <br>支持热更新和调试 |',
      '| shadcn/ui | 基于 Radix UI <br>提供无障碍组件 <br>高度可定制 |',
    ].join('\n'),
  },
};

export const MixedContent: Story = {
  name: '混合内容',
  args: {
    content: [
      '# 项目分析报告',
      '',
      '## 概述',
      '',
      '这是一个 **AI 驱动的命令行工具**，提供交互式 LLM 聊天会话。',
      '',
      '## 技术栈',
      '',
      '| 技术 | 版本 |',
      '|------|------|',
      '| Rust | 1.75+ |',
      '| React | 19.x |',
      '| TypeScript | 5.x |',
      '',
      '## 代码示例',
      '',
      '```typescript',
      'function greet(name: string): string {',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: TypeScript template literal code example
      '  return `Hello, ${name}!`;',
      '}',
      '```',
      '',
      '更多信息请访问 [项目文档](https://docs.example.com)。',
    ].join('\n'),
  },
};

export const CompleteExample: Story = {
  name: '完整示例',
  args: {
    content: [
      '# 一级标题',
      '',
      '## 二级标题',
      '',
      '### 三级标题',
      '',
      '这是一段**粗体**文字，一段*斜体*文字，以及~~删除线~~文字。',
      '还可以混合 ~~*~~**样式** 。',
      '',
      '---',
      '',
      '## 列表',
      '',
      '### 无序列表',
      '',
      '- React 19',
      '- TypeScript 6',
      '- Tailwind CSS 4',
      '  - 嵌套列表项 1',
      '  - 嵌套列表项 2',
      '',
      '### 有序列表',
      '',
      '1. 第一步：安装依赖',
      '2. 第二步：配置项目',
      '3. 第三步：启动开发服务器',
      '',
      '---',
      '',
      '## 代码',
      '',
      '### 内联代码',
      '',
      '在终端中运行 `cargo build --release` 来编译项目。',
      '使用 `npx storybook` 启动组件开发环境。',
      '',
      '### 代码块（Rust）',
      '',
      '```rust',
      'use std::collections::HashMap;',
      '',
      '/// 计算斐波那契数列',
      'fn fibonacci(n: u64) -> u64 {',
      '    match n {',
      '        0 => 0,',
      '        1 => 1,',
      '        _ => fibonacci(n - 1) + fibonacci(n - 2),',
      '    }',
      '}',
      '',
      'fn main() {',
      '    let result = fibonacci(10);',
      '    println!("fib(10) = {}", result);',
      '}',
      '```',
      '',
      '### 代码块（TypeScript）',
      '',
      '```typescript',
      'interface User {',
      '  id: string;',
      '  name: string;',
      '  email: string;',
      '}',
      '',
      'async function fetchUser(id: string): Promise<User> {',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: TypeScript template literal code example
      '  const response = await fetch(`/api/users/${id}`);',
      "  if (!response.ok) throw new Error('User not found');",
      '  return response.json();',
      '}',
      '```',
      '',
      '### 代码块（无语言标识）',
      '',
      '```',
      'This is a generic code block',
      'without language specification.',
      '```',
      '',
      '---',
      '',
      '## 表格',
      '',
      '| 组件 | 用途 | 状态 | 版本',
      '|------|------|------|------',
      '| ChatMessage | 消息渲染分发 | ✅ 已完成 | 1.0',
      '| ChatMessageList | 消息列表 + 流式 | ✅ 已完成 | 1.0',
      '| MarkdownRenderer | Markdown 渲染 | ✅ 已完成 | 1.0',
      '| ThinkingBlock | 思考过程展示 | 🔄 优化中 | 0.9',
      '| ToolApprovalCard | 工具审批 | ❌ 待开发 | ---',
      '',
      '---',
      '',
      '## 引用',
      '',
      '> 这是一个块引用。',
      '> 它可以跨越多行。',
      '>',
      '> > 这是嵌套的块引用。',
      '',
      '---',
      '',
      '## 链接与图片',
      '',
      '- 外部链接：[GitHub](https://github.com)',
      '- 项目链接：[zapmyco](https://github.com/shenjingnan/zapmyco)',
      '',
      '---',
      '',
      '## 任务列表',
      '',
      '- [x] 基础聊天功能',
      '- [x] Markdown 渲染',
      '- [x] 工具调用支持',
      '- [ ] 移动端适配',
      '- [ ] 国际化支持',
      '',
      '---',
      '',
      '## 水平线与分隔',
      '',
      '上面已经使用了多条水平线。',
      '',
      '---',
      '',
      '## 转义字符',
      '',
      '\\*这不是斜体\\* \\`这不是代码\\`',
    ].join('\n'),
  },
};

export const EmptyContent: Story = {
  name: '空字符串',
  args: {
    content: '',
  },
};
