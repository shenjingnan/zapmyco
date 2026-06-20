import { Button, Card } from 'antd';
import { useState } from 'react';
import { respondToAsk } from '../api/ask';
import { useChatStore } from '../stores/chatStore';
import { ChatInput } from './ChatInput';
import type { AskUserData } from '../types';

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
      <Card
        size="small"
        className="self-center max-w-[85%] w-full !rounded-xl"
        style={{ borderLeft: '3px solid #695e54' }}
      >
        <div className="text-xs text-muted-fg">已回答</div>
        <p className="mt-1 text-sm">{data.question}</p>
      </Card>
    );
  }

  return (
    <Card
      size="small"
      className="self-center max-w-[85%] w-full !rounded-xl"
      style={{ borderLeft: '3px solid #695e54' }}
      title={<span>❓ {data.question}</span>}
    >
      <div className="flex flex-col gap-3">
        {data.options.map((opt, idx) => (
          <Button key={opt} block loading={loading} onClick={() => handleSelect(idx)} className="!rounded-xl !justify-start">
            {idx + 1}. {opt}
          </Button>
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
    </Card>
  );
}
