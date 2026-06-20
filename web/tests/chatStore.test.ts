import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore } from '../src/stores/chatStore'

beforeEach(() => {
  useChatStore.setState({
    messages: [],
    sessionId: null,
    status: 'idle',
    currentAssistantText: '',
  })
})

describe('chatStore', () => {
  it('appends a message', () => {
    useChatStore.getState().appendMessage({
      id: '1',
      role: 'user',
      content: 'hello',
      timestamp: 1000,
    })
    expect(useChatStore.getState().messages).toHaveLength(1)
    expect(useChatStore.getState().messages[0].content).toBe('hello')
  })

  it('accumulates text_delta', () => {
    useChatStore.getState().updateAssistantText('Hello')
    useChatStore.getState().updateAssistantText(' world')
    expect(useChatStore.getState().currentAssistantText).toBe('Hello world')
  })

  it('sets session ID', () => {
    useChatStore.getState().setSessionId('web_1')
    expect(useChatStore.getState().sessionId).toBe('web_1')
  })

  it('sets status', () => {
    useChatStore.getState().setStatus('streaming')
    expect(useChatStore.getState().status).toBe('streaming')
  })

  it('finalizes assistant message and clears buffer', () => {
    useChatStore.getState().updateAssistantText('Final text')
    useChatStore.getState().finalizeAssistantMessage()
    const state = useChatStore.getState()
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].role).toBe('assistant')
    expect(state.messages[0].content).toBe('Final text')
    expect(state.currentAssistantText).toBe('')
  })

  it('adds tool approval message and sets waiting status', () => {
    useChatStore.getState().addToolApproval({
      id: 'appr_1',
      tool: 'shell_exec',
      command: 'ls -la',
    })
    const state = useChatStore.getState()
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].role).toBe('approval')
    expect(state.status).toBe('waiting')
  })

  it('adds ask user message and sets waiting status', () => {
    useChatStore.getState().addAskUser({
      id: 'ask_1',
      question: 'Which file?',
      options: ['a.txt', 'b.txt'],
    })
    const state = useChatStore.getState()
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].role).toBe('ask')
    expect(state.status).toBe('waiting')
  })

  it('adds error message', () => {
    useChatStore.getState().addError({
      code: 'AGENT_ERROR',
      message: 'Something went wrong',
    })
    const state = useChatStore.getState()
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].role).toBe('error')
    expect(state.status).toBe('error')
  })

  it('resets to initial state', () => {
    useChatStore.getState().setSessionId('web_1')
    useChatStore.getState().appendMessage({
      id: '1',
      role: 'user',
      content: 'hi',
      timestamp: 1000,
    })
    useChatStore.getState().reset()
    const state = useChatStore.getState()
    expect(state.messages).toHaveLength(0)
    expect(state.sessionId).toBeNull()
    expect(state.status).toBe('idle')
  })
})

describe('thinking state', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      currentAssistantText: '',
      currentThinking: '',
    })
  })

  it('appends to currentThinking (S1)', () => {
    const store = useChatStore.getState()
    store.appendToCurrentThinking('Let me think')
    store.appendToCurrentThinking(' about this')
    expect(useChatStore.getState().currentThinking).toBe('Let me think about this')
  })

  it('clears currentThinking (S2)', () => {
    useChatStore.getState().appendToCurrentThinking('some thought')
    useChatStore.getState().clearCurrentThinking()
    expect(useChatStore.getState().currentThinking).toBe('')
  })

  it('finalizes message with thinking (S3)', () => {
    const store = useChatStore.getState()
    store.updateAssistantText('Final answer')
    store.appendToCurrentThinking('My reasoning')
    store.finalizeAssistantMessage()
    const state = useChatStore.getState()
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].content).toBe('Final answer')
    expect(state.messages[0].thinking).toBe('My reasoning')
    expect(state.currentThinking).toBe('')
  })

  it('does not interfere with text accumulation (S5)', () => {
    const store = useChatStore.getState()
    store.appendToCurrentThinking('thinking...')
    store.updateAssistantText('text...')
    expect(useChatStore.getState().currentThinking).toBe('thinking...')
    expect(useChatStore.getState().currentAssistantText).toBe('text...')
  })

  it('clears thinking when sending new message (S6)', () => {
    const store = useChatStore.getState()
    store.appendToCurrentThinking('previous thought')
    store.updateAssistantText('previous answer')
    useChatStore.setState({ currentThinking: '', currentAssistantText: '' })
    const state = useChatStore.getState()
    expect(state.currentThinking).toBe('')
    expect(state.currentAssistantText).toBe('')
  })
})
