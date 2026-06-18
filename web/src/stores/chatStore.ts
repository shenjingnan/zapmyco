import { create } from 'zustand'
import type {
  ChatMessage,
  ErrorData,
  ToolApprovalData,
  AskUserData,
} from '../types'

export type ChatStatus =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'waiting'
  | 'done'
  | 'error'

interface ChatState {
  messages: ChatMessage[]
  sessionId: string | null
  status: ChatStatus
  currentAssistantText: string

  appendMessage: (msg: ChatMessage) => void
  updateAssistantText: (delta: string) => void
  setSessionId: (id: string) => void
  setStatus: (status: ChatStatus) => void
  addToolApproval: (data: ToolApprovalData) => void
  addAskUser: (data: AskUserData) => void
  addError: (data: ErrorData) => void
  finalizeAssistantMessage: () => void
  reset: () => void
}

const initialState = {
  messages: [],
  sessionId: null,
  status: 'idle' as ChatStatus,
  currentAssistantText: '',
}

let msgIdCounter = 0
function nextId(): string {
  msgIdCounter += 1
  return `msg_${msgIdCounter}_${Date.now()}`
}

export const useChatStore = create<ChatState>((set, get) => ({
  ...initialState,

  appendMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  updateAssistantText: (delta) =>
    set((state) => ({ currentAssistantText: state.currentAssistantText + delta })),

  setSessionId: (id) => set({ sessionId: id }),

  setStatus: (status) => set({ status }),

  addToolApproval: (data) => {
    const msg: ChatMessage = {
      id: nextId(),
      role: 'approval',
      timestamp: Date.now(),
      approvalData: data,
    }
    set((state) => ({ messages: [...state.messages, msg], status: 'waiting' }))
  },

  addAskUser: (data) => {
    const msg: ChatMessage = {
      id: nextId(),
      role: 'ask',
      timestamp: Date.now(),
      askData: data,
    }
    set((state) => ({ messages: [...state.messages, msg], status: 'waiting' }))
  },

  addError: (data) => {
    const msg: ChatMessage = {
      id: nextId(),
      role: 'error',
      timestamp: Date.now(),
      errorData: data,
    }
    set((state) => ({
      messages: [...state.messages, msg],
      status: 'error',
    }))
  },

  finalizeAssistantMessage: () => {
    const { currentAssistantText } = get()
    if (!currentAssistantText) return
    const msg: ChatMessage = {
      id: nextId(),
      role: 'assistant',
      content: currentAssistantText,
      timestamp: Date.now(),
    }
    set((state) => ({
      messages: [...state.messages, msg],
      currentAssistantText: '',
    }))
  },

  reset: () => set(initialState),
}))
