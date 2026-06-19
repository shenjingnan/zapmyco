// ── SSE 事件类型（匹配后端 StreamEvent 枚举） ──

export interface SSETextEvent {
  type: 'text';
  content: string;
}

export interface SSETextDeltaEvent {
  type: 'text_delta';
  content: string;
}

export interface SSEStatusEvent {
  type: 'status';
  content: string;
}

export interface SSEToolCallEvent {
  type: 'tool_call';
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface SSEToolProgressEvent {
  type: 'tool_progress';
  id: string;
  status: string;
}

export interface SSEToolResultEvent {
  type: 'tool_result';
  id: string;
  content: string;
}

export interface SSEToolApprovalRequiredEvent {
  type: 'tool_approval_required';
  id: string;
  tool: string;
  command: string;
  description?: string;
}

export interface SSEAskUserEvent {
  type: 'ask_user';
  id: string;
  question: string;
  options: string[];
}

export interface SSEDoneEvent {
  type: 'done';
  reason: string;
}

export interface SSEErrorEvent {
  type: 'error';
  code: string;
  message: string;
}

export type SSEEvent =
  | SSETextEvent
  | SSETextDeltaEvent
  | SSEStatusEvent
  | SSEToolCallEvent
  | SSEToolProgressEvent
  | SSEToolResultEvent
  | SSEToolApprovalRequiredEvent
  | SSEAskUserEvent
  | SSEDoneEvent
  | SSEErrorEvent;

// ── 聊天消息类型 ──

export type MessageRole = 'user' | 'assistant' | 'system' | 'error' | 'approval' | 'ask';

export interface ToolApprovalData {
  id: string;
  tool: string;
  command: string;
  description?: string;
}

export interface AskUserData {
  id: string;
  question: string;
  options: string[];
}

export interface ErrorData {
  code: string;
  message: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content?: string;
  timestamp: number;
  approvalData?: ToolApprovalData;
  askData?: AskUserData;
  errorData?: ErrorData;
}

// ── API 请求/响应类型 ──

export interface ChatRequest {
  prompt: string;
  session_id: string | null;
}

export interface ApproveRequest {
  session_id: string;
  tool_approval_id: string;
  approved: boolean;
  edited_command?: string;
}

export interface AskRespondRequest {
  session_id: string;
  ask_id: string;
  selected_idx?: number;
  custom_text?: string;
}

export interface HealthResponse {
  status: string;
  version: string;
}
