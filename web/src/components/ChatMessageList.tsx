import { useChatStore } from '../stores/chatStore'
import { useAutoScroll } from '../hooks/useAutoScroll'
import { ChatMessage } from './ChatMessage'

export function ChatMessageList() {
  const messages = useChatStore((s) => s.messages)
  const currentAssistantText = useChatStore((s) => s.currentAssistantText)
  const { anchorRef, containerRef, handleScroll } = useAutoScroll([
    messages,
    currentAssistantText,
  ])

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex flex-1 flex-col gap-2 overflow-y-auto p-4"
    >
      {messages.map((msg) => (
        <ChatMessage key={msg.id} message={msg} />
      ))}

      {/* 正在流式输出的临时消息 */}
      {currentAssistantText && (
        <div className="msg-assistant" style={{ whiteSpace: 'pre-wrap' }}>
          {currentAssistantText}
          <span className="ml-0.5 animate-pulse">▊</span>
        </div>
      )}

      <div ref={anchorRef} />
    </div>
  )
}
