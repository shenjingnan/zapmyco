import { create } from 'zustand';
import type {
  AskUserData,
  ChatMessage,
  ErrorData,
  RawAgentEvent,
  ToolApprovalData,
} from '../types';

export type ChatStatus = 'idle' | 'connecting' | 'streaming' | 'waiting' | 'done' | 'error';

interface ChatState {
  messages: ChatMessage[];
  sessionId: string | null;
  status: ChatStatus;
  currentAssistantText: string;
  currentThinking: string;
  rawEvents: RawAgentEvent[];

  appendMessage: (msg: ChatMessage) => void;
  updateAssistantText: (delta: string) => void;
  appendToCurrentThinking: (text: string) => void;
  clearCurrentThinking: () => void;
  setSessionId: (id: string) => void;
  setStatus: (status: ChatStatus) => void;
  addToolApproval: (data: ToolApprovalData) => void;
  addAskUser: (data: AskUserData) => void;
  setAskUserAnswer: (askId: string, answer: string) => void;
  addError: (data: ErrorData) => void;
  finalizeAssistantMessage: () => void;
  addRawEvent: (event: { type: string; data: string }) => void;
  clearRawEvents: () => void;
  reset: () => void;
}

const initialState = {
  messages: [],
  sessionId: null,
  status: 'idle' as ChatStatus,
  currentAssistantText: '',
  currentThinking: '',
  rawEvents: [],
};

let msgIdCounter = 0;
function nextId(): string {
  msgIdCounter += 1;
  return `msg_${msgIdCounter}_${Date.now()}`;
}

export const useChatStore = create<ChatState>((set, get) => ({
  ...initialState,

  appendMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),

  updateAssistantText: (delta) =>
    set((state) => ({ currentAssistantText: state.currentAssistantText + delta })),

  appendToCurrentThinking: (text) =>
    set((state) => ({ currentThinking: state.currentThinking + text })),

  clearCurrentThinking: () => set({ currentThinking: '' }),

  setSessionId: (id) => set({ sessionId: id }),

  setStatus: (status) => set({ status }),

  addToolApproval: (data) => {
    const msg: ChatMessage = {
      id: nextId(),
      role: 'approval',
      timestamp: Date.now(),
      approvalData: data,
    };
    set((state) => ({ messages: [...state.messages, msg], status: 'waiting' }));
  },

  addAskUser: (data) => {
    const msg: ChatMessage = {
      id: nextId(),
      role: 'ask',
      timestamp: Date.now(),
      askData: data,
    };
    set((state) => ({ messages: [...state.messages, msg], status: 'waiting' }));
  },

  setAskUserAnswer: (askId, answer) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.askData?.id === askId ? { ...msg, askData: { ...msg.askData, answer } } : msg,
      ),
    })),

  addError: (data) => {
    const msg: ChatMessage = {
      id: nextId(),
      role: 'error',
      timestamp: Date.now(),
      errorData: data,
    };
    set((state) => ({
      messages: [...state.messages, msg],
      status: 'error',
    }));
  },

  finalizeAssistantMessage: () => {
    const { currentAssistantText, currentThinking } = get();
    if (!currentAssistantText && !currentThinking) return;
    const msg: ChatMessage = {
      id: nextId(),
      role: 'assistant',
      content: currentAssistantText || '',
      timestamp: Date.now(),
      thinking: currentThinking || undefined,
    };
    set((state) => ({
      messages: [...state.messages, msg],
      currentAssistantText: '',
      currentThinking: '',
    }));
  },

  reset: () => set(initialState),

  addRawEvent: (event) =>
    set((state) => {
      const rawEvent: RawAgentEvent = {
        id: `raw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: event.type,
        data: event.data,
        timestamp: Date.now(),
      };
      const rawEvents = [...state.rawEvents, rawEvent];
      // 保留最多 500 条
      if (rawEvents.length > 500) {
        rawEvents.splice(0, rawEvents.length - 500);
      }
      return { rawEvents };
    }),
  clearRawEvents: () => set({ rawEvents: [] }),
}));
