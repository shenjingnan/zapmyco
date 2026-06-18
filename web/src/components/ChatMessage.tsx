import { Alert } from 'antd';
import { memo } from 'react';
import type { ChatMessage as ChatMessageType } from '../types';
import { AskUserCard } from './AskUserCard';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ToolApprovalCard } from './ToolApprovalCard';

interface ChatMessageProps {
  message: ChatMessageType;
}

export const ChatMessage = memo(function ChatMessage({ message }: ChatMessageProps) {
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
      return (
        <Alert
          type="error"
          showIcon
          message={message.errorData?.message || '未知错误'}
          className="self-center max-w-[85%]"
          closable
        />
      );

    default:
      return null;
  }
});
