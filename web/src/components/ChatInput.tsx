import { useState, type KeyboardEvent } from 'react'
import { Button, Input } from 'antd'
import { SendOutlined } from '@ant-design/icons'
import { useChatStore } from '../stores/chatStore'

const { TextArea } = Input

interface ChatInputProps {
  onSend: (prompt: string) => void
}

export function ChatInput({ onSend }: ChatInputProps) {
  const [value, setValue] = useState('')
  const status = useChatStore((s) => s.status)
  const disabled = status === 'connecting' || status === 'streaming' || status === 'waiting'

  const handleSend = () => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex gap-2 p-3">
      <TextArea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          status === 'waiting' ? '等待操作确认...' : '输入你的指令...'
        }
        disabled={disabled}
        autoSize={{ minRows: 1, maxRows: 4 }}
        className="flex-1"
      />
      <Button
        type="primary"
        icon={<SendOutlined />}
        onClick={handleSend}
        disabled={disabled || !value.trim()}
      >
        发送
      </Button>
    </div>
  )
}
