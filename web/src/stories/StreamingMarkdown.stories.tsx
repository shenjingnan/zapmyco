import type { Meta, StoryObj } from '@storybook/react';
import { useEffect, useMemo, useState } from 'react';
import { MarkdownRenderer } from '../components/MarkdownRenderer';

interface StreamingMarkdownDemoProps {
  /**
   * 每块内容的延迟间隔（毫秒）
   */
  interval?: number;
}

/**
 * 模拟 Agent 流式输出 markdown 的演示组件
 *
 * 每次追加一个内容块，模拟 SSE text_delta 事件逐步到达的效果。
 */
function StreamingMarkdownDemo({ interval = 800 }: StreamingMarkdownDemoProps) {
  const [displayed, setDisplayed] = useState('');
  const [chunkIndex, setChunkIndex] = useState(0);

  const chunks = useMemo(() => [
    '# 代码分析报告\n\n## 概述\n\n正在分析项目结构，请稍候...\n\n',
    '本次分析涵盖了以下模块：\n\n1. **核心引擎** — 负责 LLM 通信\n2. **工具系统** — 命令执行与审批\n3. **Web 界面** — React 前端\n\n',
    '## 核心引擎\n\n```rust\npub struct Agent {\n    client: AnthropicClient,\n    tools: Vec<Box<dyn Tool>>,\n}\n\nimpl Agent {\n    pub async fn chat(&self, prompt: &str) -> Result<String> {\n        // 与 LLM 进行流式对话\n    }\n}\n```\n\n',
    '## 性能指标\n\n| 指标 | 当前值 | 目标值 |\n|------|--------|--------|\n| 响应时间 | 1.2s | <2s ✅ |\n| 吞吐量 | 50 req/s | 30 req/s ✅ |\n| 错误率 | 0.1% | <1% ✅ |\n\n',
    '## 结论\n\n> 项目整体架构清晰，性能达标。\n\n更多详情请查看[项目文档](https://docs.example.com)。\n\n```\nStatus: PASSED\nTime: 2.3s\n```',
  ]);

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
      {chunkIndex < chunks.length && (
        <span className="ml-0.5 animate-pulse text-muted-foreground">▊</span>
      )}
      {chunkIndex >= chunks.length && (
        <p className="mt-2 text-xs text-muted-foreground">✅ 流式输出完成</p>
      )}
    </div>
  );
}

const meta: Meta<typeof StreamingMarkdownDemo> = {
  title: 'Components/StreamingMarkdown',
  component: StreamingMarkdownDemo,
};

export default meta;
type Story = StoryObj<typeof StreamingMarkdownDemo>;

export const Default: Story = {
  name: '逐块渲染（默认）',
  args: {
    interval: 800,
  },
};

export const Fast: Story = {
  name: '快速渲染',
  args: {
    interval: 300,
  },
};

export const Slow: Story = {
  name: '慢速渲染（观察细节）',
  args: {
    interval: 1500,
  },
};
