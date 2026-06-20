import { useAutoScroll } from '../hooks/useAutoScroll';
import { useChatStore } from '../stores/chatStore';
import { ChatMessage } from './ChatMessage';
import { ThinkingBlock } from './ThinkingBlock';

export function ChatMessageList() {
  const messages = useChatStore((s) => s.messages);
  const currentAssistantText = useChatStore((s) => s.currentAssistantText);
  const currentThinking = useChatStore((s) => s.currentThinking);
  const { anchorRef, containerRef, handleScroll } = useAutoScroll([messages, currentAssistantText, currentThinking]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-6"
    >
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4">
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {/* 正在流式输出的 thinking */}
        {currentThinking && <ThinkingBlock content={currentThinking} isStreaming />}

        {/* 正在流式输出的临时消息 */}
        {currentAssistantText && (
          <div className="max-w-[85%] self-start" style={{ whiteSpace: 'pre-wrap' }}>
            {currentAssistantText}
            <span className="ml-0.5 animate-pulse text-muted-foreground">▊</span>
          </div>
        )}

        <div ref={anchorRef} />
      </div>
    </div>
  );
}
