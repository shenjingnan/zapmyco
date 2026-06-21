import type { Meta, StoryObj } from '@storybook/react';
import { RawMessagePanel } from '../components/RawMessagePanel';
import { useChatStore } from '../stores/chatStore';
import { mockManyRawEvents, mockRawEvents } from './mockData';

const meta: Meta<typeof RawMessagePanel> = {
  title: 'Components/RawMessagePanel',
  component: RawMessagePanel,
  decorators: [
    (Story) => {
      useChatStore.setState({
        sessionId: 'test-session',
        rawEvents: [],
      });
      return (
        <div className="h-[600px]">
          <Story />
        </div>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof RawMessagePanel>;

export const Empty: Story = {
  name: '空状态',
};

export const MultipleEvents: Story = {
  name: '多种事件类型',
  decorators: [
    (Story) => {
      useChatStore.setState({
        sessionId: 'test-session',
        rawEvents: mockRawEvents,
      });
      return <Story />;
    },
  ],
};

export const ManyEvents: Story = {
  name: '大量事件',
  decorators: [
    (Story) => {
      useChatStore.setState({
        sessionId: 'test-session',
        rawEvents: mockManyRawEvents,
      });
      return <Story />;
    },
  ],
};
