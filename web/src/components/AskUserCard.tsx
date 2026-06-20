import { Loader2 } from 'lucide-react';
import { useState } from 'react';
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

  const handleSelect = async (idx: number) => {
    if (!sessionId) return;
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
        className="self-center max-w-[85%] w-full rounded-xl border border-border bg-white p-4"
        style={{ borderLeft: '3px solid #695e54' }}
      >
        <div className="text-xs text-muted-fg">已回答</div>
        <p className="mt-1 text-sm">{data.question}</p>
      </div>
    );
  }

  return (
    <div
      className="self-center max-w-[85%] w-full rounded-xl border border-border bg-white p-4"
      style={{ borderLeft: '3px solid #695e54' }}
    >
      <div className="mb-3 text-sm font-medium">❓ {data.question}</div>
      <div className="flex flex-col gap-3">
        {data.options.map((opt, idx) => (
          <button
            key={opt}
            type="button"
            disabled={loading}
            onClick={() => handleSelect(idx)}
            className="flex w-full items-center gap-2 rounded-xl border border-border bg-white px-4 py-2.5 text-left text-sm text-fg transition-colors hover:border-amber-600/30 hover:bg-amber-50/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            <span>
              {idx + 1}. {opt}
            </span>
          </button>
        ))}
        <ChatInput
          compact
          placeholder="输入自定义内容..."
          disabled={loading}
          onSend={async (text) => {
            if (!sessionId) return;
            await respondToAsk(sessionId, data.id, undefined, text);
          }}
        />
      </div>
    </div>
  );
}
