import { ConfigProvider, Layout } from 'antd'
import { useEffect } from 'react'
import { lightTheme } from './config/theme'
import { ChatHeader } from './components/ChatHeader'
import { ChatMessageList } from './components/ChatMessageList'
import { ChatInput } from './components/ChatInput'
import { EmptyState } from './components/EmptyState'
import { useChatStore } from './stores/chatStore'
import { useSSE } from './hooks/useSSE'
import { useSession } from './hooks/useSession'
import './App.css'

const { Header, Content, Footer } = Layout

function App() {
  const messages = useChatStore((s) => s.messages)
  const storeSessionId = useChatStore((s) => s.sessionId)
  const { sessionId, updateSessionId } = useSession()
  const { startStream } = useSSE()

  // SSE 流中返回新 session_id 时同步到 sessionStorage
  useEffect(() => {
    if (storeSessionId && storeSessionId !== sessionId) {
      updateSessionId(storeSessionId)
    }
  }, [storeSessionId, sessionId, updateSessionId])

  const handleSend = (prompt: string) => {
    startStream(prompt, storeSessionId)
  }

  return (
    <ConfigProvider theme={lightTheme}>
      <Layout className="h-screen">
        <Header className="flex items-center px-5">
          <ChatHeader />
        </Header>
        <Content className="flex flex-col overflow-hidden">
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            <ChatMessageList />
          )}
        </Content>
        <Footer className="!p-0">
          <ChatInput onSend={handleSend} />
        </Footer>
      </Layout>
    </ConfigProvider>
  )
}

export default App
