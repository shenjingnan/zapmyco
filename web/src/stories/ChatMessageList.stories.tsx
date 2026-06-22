import type { Meta, StoryObj } from '@storybook/react';
import { ChatMessageList } from '../components/ChatMessageList';
import { useChatStore } from '../stores/chatStore';
import {
  mockApprovalMessage,
  mockAssistantMessage,
  mockAssistantWithThinking,
  mockMixedMessages,
  mockSecondApprovalMessage,
  mockUserMessage,
} from './mockData';
import { MockApiProvider } from './mockFetch';

const meta: Meta<typeof ChatMessageList> = {
  title: 'Components/ChatMessageList',
  component: ChatMessageList,
  decorators: [
    (Story) => {
      useChatStore.setState({
        sessionId: 'test-session',
        status: 'idle',
        messages: [],
        currentAssistantText: '',
        currentThinking: '',
      });
      return (
        <div className="h-[500px] border rounded-lg overflow-hidden">
          <Story />
        </div>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof ChatMessageList>;

export const Empty: Story = {
  name: '空消息列表',
};

export const MixedMessages: Story = {
  name: '多条混合消息',
  decorators: [
    (Story) => {
      useChatStore.setState({
        sessionId: 'test-session',
        status: 'idle',
        messages: mockMixedMessages,
        currentAssistantText: '',
        currentThinking: '',
      });
      return <Story />;
    },
  ],
};

export const StreamingThinking: Story = {
  name: '正在思考',
  decorators: [
    (Story) => {
      useChatStore.setState({
        sessionId: 'test-session',
        status: 'streaming',
        messages: [mockUserMessage],
        currentThinking:
          '正在分析用户问题，需要从多个维度考虑：\n1. 代码结构\n2. 功能模块\n3. 依赖关系\n4. 可能的优化点',
        currentAssistantText: '',
      });
      return <Story />;
    },
  ],
};

export const StreamingText: Story = {
  name: '正在输出文本',
  decorators: [
    (Story) => {
      useChatStore.setState({
        sessionId: 'test-session',
        status: 'streaming',
        messages: [mockUserMessage, mockAssistantWithThinking],
        currentThinking: '',
        currentAssistantText:
          '根据代码分析，该项目的主要功能如下：\n\n1. AI 驱动的命令行工具\n2. 支持交互式 LLM 聊天会话\n3. 基于 React 的 Web 界面\n\n详细来说，这个项目使用 Rust 编写核心逻辑，通过 Anthropic API 实现与 LLM 的交互。前',
      });
      return <Story />;
    },
  ],
};

export const StreamingFull: Story = {
  name: '完整流式输出',
  decorators: [
    (Story) => {
      useChatStore.setState({
        sessionId: 'test-session',
        status: 'streaming',
        messages: [mockUserMessage],
        currentThinking: '用户问了一个简单问题，可以直接回答...',
        currentAssistantText: '这是一个 AI 驱动的命令行工具。它提供交互式 LLM 聊天会话功能。',
      });
      return <Story />;
    },
  ],
};

export const MultipleApprovals: Story = {
  name: '多个审批排队',
  decorators: [
    (Story) => {
      useChatStore.setState({
        sessionId: 'test-session',
        status: 'waiting',
        messages: [mockUserMessage, mockAssistantMessage, mockApprovalMessage],
        approvalQueue: mockSecondApprovalMessage.approvalData
          ? [mockSecondApprovalMessage.approvalData]
          : [],
        resolvedApprovalIds: [],
        currentAssistantText: '',
        currentThinking: '',
      });
      return (
        <MockApiProvider>
          <Story />
        </MockApiProvider>
      );
    },
  ],
};
