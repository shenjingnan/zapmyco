import type { Meta, StoryObj } from '@storybook/react';
import { StatusBar } from '../components/StatusBar';
import { useChatStore } from '../stores/chatStore';

const meta: Meta<typeof StatusBar> = {
  title: 'Components/StatusBar',
  component: StatusBar,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => {
      useChatStore.setState({
        sessionId: 'test-session',
        status: 'idle',
        messages: [],
        currentAssistantText: '',
      });
      return (
        <div className="flex h-screen flex-col bg-background text-foreground">
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            主内容区域
          </div>
          <Story />
        </div>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof StatusBar>;

export const WithDirectory: Story = {
  name: '显示工作目录',
  decorators: [
    (Story) => {
      useChatStore.setState({
        currentDir: '/Users/nemo/Projects/shenjingnan/zapmyco',
      });
      return <Story />;
    },
  ],
};

export const WithoutDirectory: Story = {
  name: '无工作目录（仅状态栏）',
  decorators: [
    (Story) => {
      useChatStore.setState({ currentDir: '' });
      return <Story />;
    },
  ],
};

export const LongPath: Story = {
  name: '长路径截断',
  decorators: [
    (Story) => {
      useChatStore.setState({
        currentDir: '/Users/nemo/Projects/shenjingnan/zapmyco/src/agent/chat.rs',
      });
      return <Story />;
    },
  ],
};
