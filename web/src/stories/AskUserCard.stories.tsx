import type { Meta, StoryObj } from '@storybook/react'
import { AskUserCard } from '../components/AskUserCard'
import { useChatStore } from '../stores/chatStore'

const meta: Meta<typeof AskUserCard> = {
  title: 'Components/AskUserCard',
  component: AskUserCard,
  decorators: [
    (Story) => {
      useChatStore.setState({
        sessionId: 'test-session',
        status: 'waiting',
        messages: [],
        currentAssistantText: '',
      })
      return <Story />
    },
  ],
}

export default meta
type Story = StoryObj<typeof AskUserCard>

export const Default: Story = {
  name: '默认（三选项）',
  args: {
    data: {
      id: 'ask_1',
      question: '你更喜欢哪个前端框架？',
      options: ['React', 'Vue', 'Svelte'],
    },
  },
}

export const TwoOptions: Story = {
  name: '两个选项',
  args: {
    data: {
      id: 'ask_2',
      question: '是否继续执行？',
      options: ['继续', '取消'],
    },
  },
}

export const ManyOptions: Story = {
  name: '多个选项',
  args: {
    data: {
      id: 'ask_3',
      question: '请选择一个颜色主题',
      options: ['深色模式', '浅色模式', '跟随系统', '暖色调', '冷色调'],
    },
  },
}

export const Answered: Story = {
  name: '已回答',
  args: {
    data: {
      id: 'ask_4',
      question: '你午餐想吃什么？',
      options: ['中餐', '西餐', '日料'],
    },
  },
  decorators: [
    (Story) => {
      useChatStore.setState({
        status: 'streaming',
        sessionId: 'test-session',
      })
      return <Story />
    },
  ],
}

export const NoSession: Story = {
  name: '无 Session',
  args: {
    data: {
      id: 'ask_5',
      question: '无法识别的问题？',
      options: ['重试', '取消'],
    },
  },
  decorators: [
    (Story) => {
      useChatStore.setState({
        sessionId: null,
        status: 'waiting',
      })
      return <Story />
    },
  ],
}
