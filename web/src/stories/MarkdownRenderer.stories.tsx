import type { Meta, StoryObj } from '@storybook/react';
import { useEffect, useState } from 'react';
import { MarkdownRenderer } from '../components/MarkdownRenderer';

const meta: Meta<typeof MarkdownRenderer> = {
  title: 'Components/MarkdownRenderer',
  component: MarkdownRenderer,
};

export default meta;
type Story = StoryObj<typeof MarkdownRenderer>;

/**
 * 模拟 Agent 流式输出的演示组件
 *
 * 将文本按块依次追加，模拟 SSE text_delta 事件逐步到达的效果。
 * 用于演示 MarkdownRenderer 在流式场景下的渲染表现。
 */
function StreamingMarkdownDemo({
  chunks,
  interval = 500,
}: {
  chunks: string[];
  interval?: number;
}) {
  const [displayed, setDisplayed] = useState('');
  const [chunkIndex, setChunkIndex] = useState(0);

  useEffect(() => {
    if (chunkIndex >= chunks.length) return;

    const timer = setTimeout(() => {
      setDisplayed((prev) => prev + chunks[chunkIndex]);
      setChunkIndex((i) => i + 1);
    }, interval);

    return () => clearTimeout(timer);
  }, [chunkIndex, chunks, interval]);

  return (
    <div className="max-w-[85%] self-start">
      <MarkdownRenderer content={displayed} />
    </div>
  );
}

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

//
// ─── 流式渲染演示 ────────────────────────────────────────────
//

export const StreamingCodeBlock: Story = {
  name: '流式代码块',
  render: () => (
    <StreamingMarkdownDemo
      interval={250}
      chunks={[
        '下面是一个计算斐波那契数列的 Rust 函数：\n\n```rust\n',
        'fn fibonacci(n: u64) -> u64 {\n',
        '    match n {\n',
        '        0 => 0,\n',
        '        1 => 1,\n',
        '        _ => fibonacci(n - 1) + fibonacci(n - 2),\n',
        '    }\n',
        '}\n',
        '```\n\n函数使用了模式匹配和递归实现，简洁优雅。',
      ]}
    />
  ),
};

export const StreamingTable: Story = {
  name: '流式表格',
  render: () => (
    <StreamingMarkdownDemo
      interval={250}
      chunks={[
        '# 服务状态监控\n\n以下是各服务的实时状态：\n\n',
        '| 服务名称 | 状态 | 响应时间 | 可用率 |\n',
        '|----------|------|----------|--------|\n',
        '| API Gateway | ✅ 正常 | 12ms | 99.9% |\n',
        '| Auth Service | ✅ 正常 | 8ms | 99.95% |\n',
        '| Database Primary | ✅ 正常 | 3ms | 99.99% |\n',
        '| Cache Cluster | ⚠️ 高负载 | 45ms | 99.5% |\n',
        '| Queue Worker | 🔄 重启中 | — | 98.2% |\n',
      ]}
    />
  ),
};

export const StreamingMixedContent: Story = {
  name: '流式混合内容',
  render: () => (
    <StreamingMarkdownDemo
      interval={250}
      chunks={[
        '# 部署报告\n\n## 概览\n\n部署正在进行中...\n\n',
        '## 服务状态\n\n',
        '| 服务 | 部署 | 健康检查 |\n|------|------|----------|\n',
        '| web | ✅ 完成 | ✅ 通过 |\n',
        '| api | ✅ 完成 | ✅ 通过 |\n',
        '| worker | 🔄 部署中 | ⏳ 等待 |\n\n',
        '## 日志\n\n```\n[INFO] Starting deployment...\n[INFO] Building images...\n[INFO] Running migrations...\n[WARN] Retry attempt 1/3\n[INFO] Deployment complete\n```\n\n',
        '> 部署脚本由 CI 自动触发。\n',
      ]}
    />
  ),
};

export const StreamingList: Story = {
  name: '流式列表',
  render: () => (
    <StreamingMarkdownDemo
      interval={200}
      chunks={[
        '# 待办事项\n\n## 今日任务\n\n',
        '- [ ] 完成代码审查\n',
        '- [ ] 更新 API 文档\n',
        '- [x] 修复登录 Bug\n',
        '- [ ] 部署到 staging 环境\n\n',
        '## 优先级\n\n',
        '1. 🔴 修复生产环境告警\n',
        '2. 🟡 更新依赖版本\n',
        '3. 🟢 优化数据库查询\n',
      ]}
    />
  ),
};

export const StreamingCompleteExample: Story = {
  name: '完整流式示例',
  render: () => (
    <StreamingMarkdownDemo
      interval={200}
      chunks={[
        '# 项目分析报告\n\n## 概览\n\n本次分析涵盖了 **zapmyco** 项目的核心模块和性能指标。\n\n',
        '## 核心模块\n\n### 1. CLI 接口\n\n- 基于 clap 4.x 的参数解析\n- 支持交互式和非交互式模式\n\n',
        '### 2. LLM 通信\n\n```rust\nuse anthropic_ai_sdk::Client;\n\nlet client = Client::new(api_key);\nlet response = client.messages()\n    .create(request)\n    .await?;\n```\n\n',
        '### 3. Web 界面\n\n| 组件 | 状态 | 版本 |\n|------|------|------|\n| ChatMessage | ✅ 已完成 | 1.0 |\n',
        '| MarkdownRenderer | ✅ 已完成 | 1.0 |\n| ThinkingBlock | 🔄 优化中 | 0.9 |\n',
        '| ToolApprovalCard | ❌ 待开发 | --- |\n\n',
        '## 性能指标\n\n| 指标 | 当前值 | 目标值 | 状态 |\n|------|--------|--------|------|\n| 响应时间 | 1.2s | < 2s | ✅ |\n',
        '| 吞吐量 | 50 req/s | > 30 req/s | ✅ |\n| 错误率 | 0.05% | < 1% | ✅ |\n\n',
        '## 总结\n\n> 项目整体健康，核心模块已就绪。\n\n详细文档请查看 [项目主页](https://github.com/shenjingnan/zapmyco)。\n',
      ]}
    />
  ),
};
