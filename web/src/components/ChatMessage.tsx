import { memo } from 'react'
import { Alert } from 'antd'
import type { ChatMessage as ChatMessageType } from '../types'
import { ToolApprovalCard } from './ToolApprovalCard'
import { AskUserCard } from './AskUserCard'
import { MarkdownRenderer } from './MarkdownRenderer'

interface ChatMessageProps {
  message: ChatMessageType
}

export const ChatMessage = memo(function ChatMessage({
  message,
}: ChatMessageProps) {
  switch (message.role) {
    case 'user':
      return (
        <div className="msg-user" style={{ whiteSpace: 'pre-wrap' }}>
          {message.content}
        </div>
      )

    case 'assistant':
      return (
        <div className="msg-assistant">
          {message.content ? (
            <MarkdownRenderer content={message.content} />
          ) : (
            '...'
          )}
        </div>
      )

    case 'system':
      return (
        <div className="self-center text-xs text-gray-500">
          {message.content}
        </div>
      )

    case 'approval':
      return message.approvalData ? (
        <ToolApprovalCard data={message.approvalData} />
      ) : null

    case 'ask':
      return message.askData ? (
        <AskUserCard data={message.askData} />
      ) : null

    case 'error':
      return (
        <Alert
          type="error"
          showIcon
          message={message.errorData?.message || '未知错误'}
          className="self-center max-w-[85%]"
          closable
        />
      )

    default:
      return null
  }
})
