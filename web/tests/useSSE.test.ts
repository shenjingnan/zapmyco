import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore } from '../src/stores/chatStore'

// 测试 SSE 事件分发逻辑（纯函数测试）
// useSSE hook 本身依赖浏览器 API（fetch, ReadableStream），
// 这里测试其 dispatchEvent 的核心逻辑

beforeEach(() => {
  useChatStore.setState({
    messages: [],
    sessionId: null,
    status: 'idle',
    currentAssistantText: '',
  })
})

describe('SSE event dispatch logic', () => {
  it('handles text_delta accumulation', () => {
    const store = useChatStore.getState()
    store.updateAssistantText('Hello')
    store.updateAssistantText(' world')
    expect(useChatStore.getState().currentAssistantText).toBe('Hello world')
  })

  it('handles finalize after text_delta', () => {
    const store = useChatStore.getState()
    store.updateAssistantText('Final message')
    store.finalizeAssistantMessage()
    const state = useChatStore.getState()
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].role).toBe('assistant')
    expect(state.messages[0].content).toBe('Final message')
    expect(state.currentAssistantText).toBe('')
  })

  it('handles status with session_id', () => {
    const store = useChatStore.getState()
    // 模拟 status 事件处理
    const content = 'session_id: web_1'
    if (content.startsWith('session_id:')) {
      store.setSessionId(content.split(':')[1].trim())
    }
    expect(useChatStore.getState().sessionId).toBe('web_1')
  })

  it('handles done event', () => {
    const store = useChatStore.getState()
    store.updateAssistantText('Some text')
    store.finalizeAssistantMessage()
    store.setStatus('done')
    const state = useChatStore.getState()
    expect(state.status).toBe('done')
    expect(state.messages).toHaveLength(1)
  })

  it('handles error event', () => {
    const store = useChatStore.getState()
    store.addError({ code: 'AGENT_ERROR', message: 'Failed' })
    const state = useChatStore.getState()
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].role).toBe('error')
    expect(state.status).toBe('error')
  })

  it('handles tool_approval_required', () => {
    const store = useChatStore.getState()
    store.addToolApproval({
      id: 'appr_1',
      tool: 'shell_exec',
      command: 'ls -la',
      description: 'List files',
    })
    const state = useChatStore.getState()
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].role).toBe('approval')
    expect(state.status).toBe('waiting')
  })

  it('handles ask_user', () => {
    const store = useChatStore.getState()
    store.addAskUser({
      id: 'ask_1',
      question: 'Continue?',
      options: ['Yes', 'No'],
    })
    const state = useChatStore.getState()
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].role).toBe('ask')
    expect(state.status).toBe('waiting')
  })
})

describe('thinking SSE events', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      currentAssistantText: '',
      currentThinking: '',
    })
  })

  it('dispatches thinking_delta to currentThinking (E1)', () => {
    useChatStore.getState().appendToCurrentThinking('reasoning step')
    expect(useChatStore.getState().currentThinking).toBe('reasoning step')
  })

  it('interleaves thinking_delta and text_delta (E2)', () => {
    const store = useChatStore.getState()
    store.appendToCurrentThinking('thinking step 1')
    store.updateAssistantText('text part 1')
    store.appendToCurrentThinking('thinking step 2')
    store.updateAssistantText('text part 2')
    const state = useChatStore.getState()
    expect(state.currentThinking).toBe('thinking step 1thinking step 2')
    expect(state.currentAssistantText).toBe('text part 1text part 2')
  })

  it('finalizes thinking on done (E3)', () => {
    const store = useChatStore.getState()
    store.updateAssistantText('Final answer')
    store.appendToCurrentThinking('My reasoning')
    store.finalizeAssistantMessage()
    const state = useChatStore.getState()
    expect(state.messages[0].thinking).toBe('My reasoning')
    expect(state.currentThinking).toBe('')
  })
})
