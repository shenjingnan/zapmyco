import { ConfigProvider } from 'antd';
import { useEffect } from 'react';
import { ChatInput } from './components/ChatInput';
import { ChatMessageList } from './components/ChatMessageList';
import { EmptyState } from './components/EmptyState';
import { RawMessagePanel } from './components/RawMessagePanel';
import { warmTheme } from './config/theme';
import { useSession } from './hooks/useSession';
import { useSSE } from './hooks/useSSE';
import { useChatStore } from './stores/chatStore';
import './App.css';

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
    <ConfigProvider theme={warmTheme}>
      <div className="flex h-screen flex-row bg-bg text-fg">
        <div className="flex min-w-0 flex-1 flex-col">
          {hasMessages ? (
            <>
              <ChatMessageList />
              <div className="px-4 py-3">
                <ChatInput onSend={handleSend} />
              </div>
            </>
          ) : (
            <EmptyState onSend={handleSend} />
          )}
        </div>
        <RawMessagePanel />
      </div>
    </ConfigProvider>
  );
}

export default App;
