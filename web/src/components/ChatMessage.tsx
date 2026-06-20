import { CircleAlert, X } from 'lucide-react';
import { memo, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
          className="max-w-[75%] self-end rounded-lg bg-muted px-3.5 py-2.5"
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
      return <div className="self-center text-xs text-muted-foreground">{message.content}</div>;

    case 'approval':
      return message.approvalData ? <ToolApprovalCard data={message.approvalData} /> : null;

    case 'ask':
      return message.askData ? <AskUserCard data={message.askData} /> : null;

    case 'error':
      return alertVisible ? (
        <Alert variant="destructive" className="self-center max-w-[85%]">
          <CircleAlert className="size-4" />
          <AlertDescription className="flex-1 text-sm">
            {message.errorData?.message || '未知错误'}
          </AlertDescription>
          <Button
            type="button"
            onClick={() => setAlertVisible(false)}
            variant="ghost"
            size="icon-xs"
            className="shrink-0"
          >
            <X />
          </Button>
        </Alert>
      ) : null;

    default:
      return null;
  }
});
