import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { respondToAsk } from '../api/ask';
import { useChatStore } from '../stores/chatStore';
import type { AskUserData } from '../types';
import { ChatInput } from './ChatInput';

interface AskUserCardProps {
  data: AskUserData;
}

export function AskUserCard({ data }: AskUserCardProps) {
  const [loading, setLoading] = useState(false);
  const sessionId = useChatStore((s) => s.sessionId);
  const status = useChatStore((s) => s.status);

  const setAskUserAnswer = useChatStore((s) => s.setAskUserAnswer);

  const handleSelect = async (idx: number) => {
    if (!sessionId) return;
    setAskUserAnswer(data.id, data.options[idx]);
    setLoading(true);
    try {
      await respondToAsk(sessionId, data.id, idx);
    } catch {
      // 错误已在 client.ts 中处理
    } finally {
      setLoading(false);
    }
  };

  if (status !== 'waiting') {
    return (
      <div
        className="self-center max-w-[85%] w-full rounded-xl border border-border bg-card p-4"
      >
        <div className="text-xs text-muted-foreground">已回答</div>
        <p className="mt-1 text-sm">{data.question}</p>
        {data.answer && (
          <div className="mt-2 rounded-md bg-muted px-3 py-2 text-sm">
            {data.answer}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="self-center max-w-[85%] w-full rounded-xl border border-border bg-card p-4">
      <div className="mb-3 text-sm font-medium">{data.question}</div>
      <div className="flex flex-col gap-3">
        {data.options.map((opt, idx) => (
          <Button
            key={opt}
            type="button"
            disabled={loading}
            onClick={() => handleSelect(idx)}
            variant="outline"
            className="justify-start"
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            <span>
              {idx + 1}. {opt}
            </span>
          </Button>
        ))}
        <ChatInput
          compact
          placeholder="输入自定义内容..."
          disabled={loading}
          onSend={async (text) => {
            if (!sessionId) return;
            setAskUserAnswer(data.id, text);
            await respondToAsk(sessionId, data.id, undefined, text);
          }}
        />
      </div>
    </div>
  );
}
