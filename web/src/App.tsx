import { useEffect } from 'react';
import { ChatInput } from './components/ChatInput';
import { ChatMessageList } from './components/ChatMessageList';
import { EmptyState } from './components/EmptyState';
import { RawMessagePanel } from './components/RawMessagePanel';
import { StatusBar } from './components/StatusBar';
import { useSession } from './hooks/useSession';
import { useSSE } from './hooks/useSSE';
import { useChatStore } from './stores/chatStore';

function App() {
  const messages = useChatStore((s) => s.messages);
  const storeSessionId = useChatStore((s) => s.sessionId);
  const { sessionId, updateSessionId } = useSession();
  const { startStream } = useSSE();

  // SSE 流中返回新 session_id 时同步到 sessionStorage
  useEffect(() => {
    if (storeSessionId && storeSessionId !== sessionId) {
      updateSessionId(storeSessionId);
    }
  }, [storeSessionId, sessionId, updateSessionId]);

  const handleSend = (prompt: string) => {
    startStream(prompt, storeSessionId);
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-row">
        <div className="flex min-w-0 flex-1 flex-col">
          {hasMessages ? (
            <>
              <ChatMessageList />
              <div className="mx-auto w-full max-w-[900px] px-4">
                <div className="py-3">
                  <ChatInput onSend={handleSend} />
                </div>
              </div>
            </>
          ) : (
            <EmptyState onSend={handleSend} />
          )}
        </div>
        <RawMessagePanel />
      </div>
      <StatusBar />
    </div>
  );
}

export default App;
