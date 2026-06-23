import type { ChatMessage, RawAgentEvent } from '../types';

export const mockUserMessage: ChatMessage = {
  id: 'msg_user_1',
  role: 'user',
  content: '帮我分析一下这个项目的主要功能是什么？',
  timestamp: Date.now() - 60000,
};

export const mockAssistantMessage: ChatMessage = {
  id: 'msg_assistant_1',
  role: 'assistant',
  content: `根据代码分析，该项目的主要功能包括：

1. **AI 聊天交互** — 基于 Anthropic API 的流式对话
2. **工具调用** — 支持 Shell 命令执行、文件操作等
3. **Web 界面** — 基于 React 的现代化聊天 UI

\`\`\`rust
fn main() {
    println!("Hello, World!");
}
\`\`\`

| 功能 | 状态 |
|------|------|
| 聊天 | ✅ |
| 工具 | ✅ |
| Web 界面 | ✅ |`,
  timestamp: Date.now() - 55000,
};

export const mockAssistantWithThinking: ChatMessage = {
  id: 'msg_assistant_2',
  role: 'assistant',
  thinking:
    '用户想了解项目的主要功能。我需要从代码结构来分析：\n1. 首先看 Cargo.toml 了解依赖\n2. 然后看 src/ 目录了解模块结构\n3. 最后看 web/ 目录了解前端功能',
  content: '根据代码分析，这是一个 AI 驱动的命令行工具，提供交互式 LLM 聊天会话。',
  timestamp: Date.now() - 50000,
};

export const mockAssistantEmptyContent: ChatMessage = {
  id: 'msg_assistant_3',
  role: 'assistant',
  content: '',
  timestamp: Date.now() - 45000,
};

export const mockSystemMessage: ChatMessage = {
  id: 'msg_system_1',
  role: 'system',
  content: '任务已完成，共处理 3 个文件。',
  timestamp: Date.now() - 40000,
};

export const mockApprovalMessage: ChatMessage = {
  id: 'msg_approval_1',
  role: 'approval',
  timestamp: Date.now() - 30000,
  approvalData: {
    id: 'tool_1',
    tool: 'bash',
    command: 'ls -la src/',
    description: '查看源代码目录结构',
  },
};

export const mockApprovalProcessedMessage: ChatMessage = {
  id: 'msg_approval_2',
  role: 'approval',
  timestamp: Date.now() - 25000,
  approvalData: {
    id: 'tool_2',
    tool: 'file_write',
    command: 'echo "hello" > /tmp/test.txt',
    description: '写入测试文件',
  },
};

export const mockAskMessage: ChatMessage = {
  id: 'msg_ask_1',
  role: 'ask',
  timestamp: Date.now() - 20000,
  askData: {
    id: 'ask_1',
    question: '你希望生成什么类型的代码？',
    options: ['Rust 后端', 'TypeScript 前端', 'Python 脚本', '配置文件'],
  },
};

export const mockAskAnsweredMessage: ChatMessage = {
  id: 'msg_ask_2',
  role: 'ask',
  timestamp: Date.now() - 15000,
  askData: {
    id: 'ask_2',
    question: '是否继续执行？',
    options: ['继续', '取消'],
    answer: '继续',
  },
};

export const mockErrorMessage: ChatMessage = {
  id: 'msg_error_1',
  role: 'error',
  timestamp: Date.now() - 10000,
  errorData: {
    code: 'API_ERROR',
    message: '请求超时，请检查网络连接后重试。',
  },
};

export const mockSecondApprovalMessage: ChatMessage = {
  id: 'msg_approval_3',
  role: 'approval',
  timestamp: Date.now() - 5000,
  approvalData: {
    id: 'tool_3',
    tool: 'bash',
    command: 'git push origin main --force',
    description: '强制推送当前分支到远程仓库',
  },
};

export const mockMixedMessages: ChatMessage[] = [
  mockUserMessage,
  mockAssistantWithThinking,
  mockSystemMessage,
  mockApprovalProcessedMessage,
  mockErrorMessage,
];

export const mockRawEvents: RawAgentEvent[] = [
  {
    id: 'raw_1',
    type: 'text_delta',
    data: JSON.stringify({ content: '正在' }),
    timestamp: Date.now() - 8000,
  },
  {
    id: 'raw_2',
    type: 'text_delta',
    data: JSON.stringify({ content: '分析' }),
    timestamp: Date.now() - 7500,
  },
  {
    id: 'raw_3',
    type: 'text_delta',
    data: JSON.stringify({ content: '代码...' }),
    timestamp: Date.now() - 7000,
  },
  {
    id: 'raw_4',
    type: 'thinking_delta',
    data: JSON.stringify({ content: '正在思考用户问题' }),
    timestamp: Date.now() - 6500,
  },
  {
    id: 'raw_5',
    type: 'status',
    data: JSON.stringify({ content: '处理中...' }),
    timestamp: Date.now() - 6000,
  },
  {
    id: 'raw_6',
    type: 'tool_call',
    data: JSON.stringify({ id: 't1', tool: 'bash', args: { command: 'ls' } }),
    timestamp: Date.now() - 5000,
  },
  {
    id: 'raw_7',
    type: 'tool_progress',
    data: JSON.stringify({ id: 't1', status: 'running' }),
    timestamp: Date.now() - 4500,
  },
  {
    id: 'raw_8',
    type: 'tool_result',
    data: JSON.stringify({ id: 't1', content: 'src/\nweb/\ndocs/' }),
    timestamp: Date.now() - 4000,
  },
  {
    id: 'raw_9',
    type: 'tool_approval_required',
    data: JSON.stringify({ id: 't2', tool: 'bash', command: 'rm -rf /tmp/test' }),
    timestamp: Date.now() - 3000,
  },
  {
    id: 'raw_10',
    type: 'ask_user',
    data: JSON.stringify({ id: 'a1', question: '是否继续？', options: ['是', '否'] }),
    timestamp: Date.now() - 2000,
  },
  {
    id: 'raw_11',
    type: 'done',
    data: JSON.stringify({ reason: 'completed' }),
    timestamp: Date.now() - 1000,
  },
  {
    id: 'raw_12',
    type: 'error',
    data: JSON.stringify({ code: 'RATE_LIMIT', message: '请求过于频繁' }),
    timestamp: Date.now(),
  },
];

export const mockManyRawEvents: RawAgentEvent[] = Array.from({ length: 18 }, (_, i) => ({
  id: `raw_many_${i + 1}`,
  type: [
    'text_delta',
    'thinking_delta',
    'status',
    'tool_call',
    'tool_progress',
    'tool_result',
    'done',
  ][i % 7],
  data: JSON.stringify({ content: `事件 ${i + 1} 的内容` }),
  timestamp: Date.now() - (18 - i) * 1000,
}));
