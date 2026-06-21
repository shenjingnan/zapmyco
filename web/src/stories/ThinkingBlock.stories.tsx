import type { Meta, StoryObj } from '@storybook/react';
import { ThinkingBlock } from '../components/ThinkingBlock';

const meta: Meta<typeof ThinkingBlock> = {
  title: 'Components/ThinkingBlock',
  component: ThinkingBlock,
};

export default meta;
type Story = StoryObj<typeof ThinkingBlock>;

export const Collapsed: Story = {
  name: '折叠状态（默认）',
  args: {
    content: '这是模型的思考过程，默认处于折叠状态，需要点击展开查看。',
    isStreaming: false,
  },
};

export const Streaming: Story = {
  name: '流式输出中',
  args: {
    content: '正在分析用户问题，需要从多个维度考虑...',
    isStreaming: true,
  },
};

export const LongContent: Story = {
  name: '长内容',
  args: {
    content: [
      '这是一个很长的思考过程：',
      '',
      '首先，我需要理解用户的问题意图。用户想要了解项目的核心功能，这意味着我需要从整体架构出发，分析各个模块的职责。',
      '',
      '其次，我需要考虑项目的技术栈组成。项目使用 Rust 作为后端语言，搭配 React + TypeScript 前端，通过 SSE 实现流式通信。',
      '',
      '最后，我需要总结出清晰的功能列表，并按重要性排序呈现给用户。',
      '',
      '此外，还需要注意一些实现细节，比如工具调用的审批流程、错误处理机制等。',
    ].join('\n'),
    isStreaming: false,
  },
};

export const EmptyContent: Story = {
  name: '空内容',
  args: {
    content: '',
    isStreaming: false,
  },
};
