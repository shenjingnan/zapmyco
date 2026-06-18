import { Tag } from 'antd'
import { useChatStore } from '../stores/chatStore'
import type { ChatStatus } from '../stores/chatStore'

const statusConfig: Record<ChatStatus, { color: string; label: string }> = {
  idle: { color: 'green', label: '● 就绪' },
  connecting: { color: 'blue', label: '● 连接中...' },
  streaming: { color: 'blue', label: '● 思考中...' },
  waiting: { color: 'yellow', label: '● 等待操作' },
  done: { color: 'green', label: '● 完成' },
  error: { color: 'red', label: '● 错误' },
}

export function ChatHeader() {
  const status = useChatStore((s) => s.status)
  const sessionId = useChatStore((s) => s.sessionId)
  const config = statusConfig[status]

  return (
    <div className="flex items-center gap-3">
      <h1 className="m-0 text-base text-white">Zapmyco</h1>
      <span className="text-xs" style={{ color: config.color }}>
        {config.label}
      </span>
      {sessionId && (
        <Tag className="text-[11px]" color="default">
          {sessionId.length > 8
            ? `ID: ${sessionId.slice(0, 8)}...`
            : `ID: ${sessionId}`}
        </Tag>
      )}
    </div>
  )
}
