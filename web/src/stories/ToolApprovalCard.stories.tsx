import type { Meta, StoryObj } from '@storybook/react';
import { ToolApprovalCard } from '../components/ToolApprovalCard';
import { useChatStore } from '../stores/chatStore';

const meta: Meta<typeof ToolApprovalCard> = {
  title: 'Components/ToolApprovalCard',
  component: ToolApprovalCard,
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

export default meta;
type Story = StoryObj<typeof ToolApprovalCard>;

export const Pending: Story = {
  name: '待审批',
  args: {
    data: {
      id: 'tool_1',
      tool: 'bash',
      command: 'ls -la src/',
      description: '查看源代码目录结构',
    },
  },
};

export const Processed: Story = {
  name: '已处理',
  args: {
    data: {
      id: 'tool_2',
      tool: 'file_write',
      command: 'echo "hello" > /tmp/test.txt',
      description: '写入测试文件',
    },
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

export const WithDescription: Story = {
  name: '含描述信息',
  args: {
    data: {
      id: 'tool_3',
      tool: 'code',
      command: `sed -i 's/old_text/new_text/g' src/main.rs`,
      description: '批量替换文本文件中所有匹配的字符串，将 old_text 替换为 new_text',
    },
  },
};

export const WithoutDescription: Story = {
  name: '无描述',
  args: {
    data: {
      id: 'tool_4',
      tool: 'bash',
      command: 'rm -rf /tmp/test',
    },
  },
};

export const LongCommand: Story = {
  name: '长命令',
  args: {
    data: {
      id: 'tool_5',
      tool: 'bash',
      command:
        'find . -type f -name "*.ts" -o -name "*.tsx" | xargs grep -l "TODO\\|FIXME" | head -20 | sort',
      description: '查找项目中所有包含 TODO 或 FIXME 标记的文件',
    },
  },
};

export const NoSession: Story = {
  name: '无 Session',
  args: {
    data: {
      id: 'tool_6',
      tool: 'bash',
      command: 'echo "hello"',
    },
  },
  decorators: [
    (Story) => {
      useChatStore.setState({
        sessionId: null,
        status: 'waiting',
      });
      return <Story />;
    },
  ],
};
