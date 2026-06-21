import type { Meta, StoryObj } from '@storybook/react';
import { EmptyState } from '../components/EmptyState';
import { useChatStore } from '../stores/chatStore';

const meta: Meta<typeof EmptyState> = {
  title: 'Components/EmptyState',
  component: EmptyState,
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
type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {
  name: '默认',
  args: {
    onSend: (prompt: string) => console.log('发送:', prompt),
  },
};
