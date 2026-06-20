import { CircleAlert, X } from 'lucide-react';
import { memo, useState } from 'react';
import type { ChatMessage as ChatMessageType } from '../types';
import { AskUserCard } from './AskUserCard';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ToolApprovalCard } from './ToolApprovalCard';

interface ChatMessageProps {
  message: ChatMessageType;
}

export const ChatMessage = memo(function ChatMessage({ message }: ChatMessageProps) {
  const [alertVisible, setAlertVisible] = useState(true);

  switch (message.role) {
    case 'user':
      return (
        <div
          className="max-w-[75%] self-end rounded-lg bg-user-bg px-3.5 py-2.5"
          style={{ whiteSpace: 'pre-wrap' }}
        >
          {message.content}
        </div>
      );

    case 'assistant':
      return (
        <div className="max-w-[85%] self-start">
          {message.content ? <MarkdownRenderer content={message.content} /> : '...'}
        </div>
      );

    case 'system':
      return <div className="self-center text-xs text-muted-fg">{message.content}</div>;

    case 'approval':
      return message.approvalData ? <ToolApprovalCard data={message.approvalData} /> : null;

    case 'ask':
      return message.askData ? <AskUserCard data={message.askData} /> : null;

    case 'error':
      return alertVisible ? (
        <div className="self-center max-w-[85%] flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
          <CircleAlert size={16} className="mt-0.5 shrink-0 text-red-500" />
          <p className="flex-1 text-sm text-red-700">{message.errorData?.message || '未知错误'}</p>
          <button
            type="button"
            onClick={() => setAlertVisible(false)}
            className="shrink-0 rounded p-0.5 text-red-400 transition-colors hover:bg-red-100 hover:text-red-600"
          >
            <X size={14} />
          </button>
        </div>
      ) : null;

    default:
      return null;
  }
});
