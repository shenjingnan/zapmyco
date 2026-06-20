import type { Meta, StoryObj } from '@storybook/react';
import { ChatInput } from '../components/ChatInput';
import { useChatStore } from '../stores/chatStore';

const meta: Meta<typeof ChatInput> = {
  title: 'Components/ChatInput',
  component: ChatInput,
  decorators: [
    (Story) => {
      useChatStore.setState({
        sessionId: 'test-session',
        status: 'idle',
        messages: [],
        currentAssistantText: '',
      });
      return (
        <div className="mx-auto max-w-[900px] p-4">
          <Story />
        </div>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof ChatInput>;

export const Default: Story = {
  name: '默认状态',
  args: {
    onSend: (prompt: string) => console.log('发送:', prompt),
  },
};

export const Compact: Story = {
  name: '紧凑模式',
  args: {
    onSend: (prompt: string) => console.log('发送:', prompt),
    compact: true,
  },
};

export const Waiting: Story = {
  name: '等待确认（禁用）',
  args: {
    onSend: (prompt: string) => console.log('发送:', prompt),
  },
  decorators: [
    (Story) => {
      useChatStore.setState({ status: 'waiting' });
      return <Story />;
    },
  ],
};

export const Streaming: Story = {
  name: '回复中（禁用）',
  args: {
    onSend: (prompt: string) => console.log('发送:', prompt),
  },
  decorators: [
    (Story) => {
      useChatStore.setState({ status: 'streaming' });
      return <Story />;
    },
  ],
};

export const Connecting: Story = {
  name: '连接中（禁用）',
  args: {
    onSend: (prompt: string) => console.log('发送:', prompt),
  },
  decorators: [
    (Story) => {
      useChatStore.setState({ status: 'connecting' });
      return <Story />;
    },
  ],
};
