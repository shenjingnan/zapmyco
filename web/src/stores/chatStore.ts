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
  currentDir: string;
  approvalQueue: ToolApprovalData[];
  resolvedApprovalIds: string[];
  askQueue: AskUserData[];
  resolvedAskIds: string[];

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
  setCurrentDir: (path: string) => void;
  reset: () => void;
  resolveApproval: (id: string) => void;
  resolveAsk: (id: string) => void;
}

const initialState = {
  messages: [],
  sessionId: null,
  status: 'idle' as ChatStatus,
  currentAssistantText: '',
  currentThinking: '',
  rawEvents: [],
  currentDir: '',
  approvalQueue: [],
  resolvedApprovalIds: [],
  askQueue: [],
  resolvedAskIds: [],
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
    const state = get();
    const hasPending = state.messages.some(
      (m) =>
        m.role === 'approval' &&
        m.approvalData &&
        !state.resolvedApprovalIds.includes(m.approvalData.id),
    );
    if (hasPending) {
      set({ approvalQueue: [...state.approvalQueue, data] });
    } else {
      const msg: ChatMessage = {
        id: nextId(),
        role: 'approval',
        timestamp: Date.now(),
        approvalData: data,
      };
      set({ messages: [...state.messages, msg], status: 'waiting' });
    }
  },

  addAskUser: (data) => {
    const state = get();
    const hasPending = state.messages.some(
      (m) => m.role === 'ask' && m.askData && !state.resolvedAskIds.includes(m.askData.id),
    );
    if (hasPending) {
      set({ askQueue: [...state.askQueue, data] });
    } else {
      const msg: ChatMessage = {
        id: nextId(),
        role: 'ask',
        timestamp: Date.now(),
        askData: data,
      };
      set({ messages: [...state.messages, msg], status: 'waiting' });
    }
  },

  setAskUserAnswer: (askId, answer) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.askData?.id === askId ? { ...msg, askData: { ...msg.askData, answer } } : msg,
      ),
    })),

  resolveApproval: (id) => {
    const state = get();
    const newResolved = [...state.resolvedApprovalIds, id];
    if (state.approvalQueue.length > 0) {
      const [next, ...rest] = state.approvalQueue;
      const msg: ChatMessage = {
        id: nextId(),
        role: 'approval',
        timestamp: Date.now(),
        approvalData: next,
      };
      set({
        messages: [...state.messages, msg],
        resolvedApprovalIds: newResolved,
        approvalQueue: rest,
        status: 'waiting',
      });
    } else {
      set({ resolvedApprovalIds: newResolved });
    }
  },

  resolveAsk: (id) => {
    const state = get();
    const newResolved = [...state.resolvedAskIds, id];
    if (state.askQueue.length > 0) {
      const [next, ...rest] = state.askQueue;
      const msg: ChatMessage = {
        id: nextId(),
        role: 'ask',
        timestamp: Date.now(),
        askData: next,
      };
      set({
        messages: [...state.messages, msg],
        resolvedAskIds: newResolved,
        askQueue: rest,
        status: 'waiting',
      });
    } else {
      set({ resolvedAskIds: newResolved });
    }
  },

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
  setCurrentDir: (path) => set({ currentDir: path }),
}));
