import { Button, Card, Input, Space } from 'antd';
import { Check, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { approveTool } from '../api/tool';
import { useChatStore } from '../stores/chatStore';
import type { ToolApprovalData } from '../types';

interface ToolApprovalCardProps {
  data: ToolApprovalData;
}

export function ToolApprovalCard({ data }: ToolApprovalCardProps) {
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedCmd, setEditedCmd] = useState(data.command);
  const sessionId = useChatStore((s) => s.sessionId);
  const status = useChatStore((s) => s.status);

  const handleAction = async (approved: boolean) => {
    if (!sessionId) return;
    setLoading(true);
    try {
      await approveTool(
        sessionId,
        data.id,
        approved,
        approved && editedCmd !== data.command ? editedCmd : undefined,
      );
    } catch {
      // 错误已在 client.ts 中处理
    } finally {
      setLoading(false);
    }
  };

  // 如果已经处理过，不再显示操作按钮
  if (status !== 'waiting') {
    return (
      <Card
        size="small"
        className="self-center max-w-[85%] w-full"
        style={{ borderLeft: '3px solid #695e54' }}
      >
        <div className="text-xs text-muted-fg">工具已处理</div>
        <code className="block mt-1 text-xs">{data.command}</code>
      </Card>
    );
  }

  return (
    <Card
      size="small"
      className="self-center max-w-[85%] w-full"
      style={{ borderLeft: '3px solid #695e54' }}
      title={<span className="text-xs">⚠️ 需要审批 - {data.tool}</span>}
    >
      {data.description && <p className="mb-2 text-xs text-muted-fg">{data.description}</p>}

      {editing ? (
        <Input
          size="small"
          value={editedCmd}
          onChange={(e) => setEditedCmd(e.target.value)}
          className="mb-2 font-mono text-xs"
        />
      ) : (
        <code className="mb-2 block rounded bg-code-bg p-2 text-xs text-fg">{data.command}</code>
      )}

      <Space className="mt-2">
        <Button
          size="small"
          type="primary"
          icon={<Check size={14} />}
          loading={loading}
          onClick={() => handleAction(true)}
        >
          允许
        </Button>
        <Button
          size="small"
          danger
          icon={<X size={14} />}
          loading={loading}
          onClick={() => handleAction(false)}
        >
          拒绝
        </Button>
        <Button size="small" icon={<Pencil size={14} />} onClick={() => setEditing(!editing)}>
          {editing ? '完成编辑' : '编辑'}
        </Button>
      </Space>
    </Card>
  );
}
