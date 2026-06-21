import type { Meta, StoryObj } from '@storybook/react';
import { ChatMessage } from '../components/ChatMessage';
import { useChatStore } from '../stores/chatStore';
import {
  mockApprovalMessage,
  mockApprovalProcessedMessage,
  mockAskAnsweredMessage,
  mockAskMessage,
  mockAssistantEmptyContent,
  mockAssistantMessage,
  mockAssistantWithThinking,
  mockErrorMessage,
  mockSystemMessage,
  mockUserMessage,
} from './mockData';

const meta: Meta<typeof ChatMessage> = {
  title: 'Components/ChatMessage',
  component: ChatMessage,
  decorators: [
    (Story) => {
      useChatStore.setState({
        sessionId: 'test-session',
        status: 'idle',
        messages: [],
        currentAssistantText: '',
      });
      return <Story />;
    },
  ],
};

export default meta;
type Story = StoryObj<typeof ChatMessage>;

export const UserMessage: Story = {
  name: '用户消息',
  args: {
    message: mockUserMessage,
  },
};

export const AssistantPlainText: Story = {
  name: '助手消息（纯文本）',
  args: {
    message: {
      ...mockAssistantMessage,
      content: '这是一段纯文本回复，不包含 Markdown 格式。\n\n支持多行显示。',
    },
  },
};

export const AssistantWithMarkdown: Story = {
  name: '助手消息（含 Markdown）',
  args: {
    message: mockAssistantMessage,
  },
};

export const AssistantWithThinking: Story = {
  name: '助手消息（含思考过程）',
  args: {
    message: mockAssistantWithThinking,
  },
};

export const AssistantEmptyContent: Story = {
  name: '助手消息（空内容）',
  args: {
    message: mockAssistantEmptyContent,
  },
};

export const SystemMessage: Story = {
  name: '系统消息',
  args: {
    message: mockSystemMessage,
  },
};

export const ApprovalPending: Story = {
  name: '审批消息（待处理）',
  args: {
    message: mockApprovalMessage,
  },
  decorators: [
    (Story) => {
      useChatStore.setState({
        sessionId: 'test-session',
        status: 'waiting',
      });
      return <Story />;
    },
  ],
};

export const ApprovalProcessed: Story = {
  name: '审批消息（已处理）',
  args: {
    message: mockApprovalProcessedMessage,
  },
  decorators: [
    (Story) => {
      useChatStore.setState({
        sessionId: 'test-session',
        status: 'streaming',
      });
      return <Story />;
    },
  ],
};

export const AskUnanswered: Story = {
  name: '询问消息（未回答）',
  args: {
    message: mockAskMessage,
  },
  decorators: [
    (Story) => {
      useChatStore.setState({
        sessionId: 'test-session',
        status: 'waiting',
      });
      return <Story />;
    },
  ],
};

export const AskAnswered: Story = {
  name: '询问消息（已回答）',
  args: {
    message: mockAskAnsweredMessage,
  },
  decorators: [
    (Story) => {
      useChatStore.setState({
        sessionId: 'test-session',
        status: 'streaming',
      });
      return <Story />;
    },
  ],
};

export const ErrorMessage: Story = {
  name: '错误消息',
  args: {
    message: mockErrorMessage,
  },
};

export const UnknownRole: Story = {
  name: '未知角色',
  args: {
    message: {
      id: 'msg_unknown',
      role: 'unknown' as never,
      timestamp: Date.now(),
    },
  },
};
