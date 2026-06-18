import { Button, Card, Space } from 'antd';
import { useState } from 'react';
import { respondToAsk } from '../api/ask';
import { useChatStore } from '../stores/chatStore';
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
        className="self-center max-w-[85%] w-full"
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
      className="self-center max-w-[85%] w-full"
      style={{ borderLeft: '3px solid #695e54' }}
      title={<span className="text-xs">❓ {data.question}</span>}
    >
      <Space wrap>
        {data.options.map((opt, idx) => (
          <Button key={opt} size="small" loading={loading} onClick={() => handleSelect(idx)}>
            {opt}
          </Button>
        ))}
      </Space>
    </Card>
  );
}
