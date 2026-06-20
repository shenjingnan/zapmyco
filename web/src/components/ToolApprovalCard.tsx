import { Check, Loader2, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
      <div
        className="self-center max-w-[85%] w-full rounded-xl border border-border bg-card p-4"
        style={{ borderLeft: '3px solid #a1a1aa' }}
      >
        <div className="text-xs text-muted-foreground">工具已处理</div>
        <code className="mt-1 block text-xs">{data.command}</code>
      </div>
    );
  }

  return (
    <div
      className="self-center max-w-[85%] w-full rounded-xl border border-border bg-card p-4"
      style={{ borderLeft: '3px solid #a1a1aa' }}
    >
      <div className="mb-3 text-xs font-medium text-foreground">⚠️ 需要审批 - {data.tool}</div>

      {data.description && <p className="mb-2 text-xs text-muted-foreground">{data.description}</p>}

      {editing ? (
        <Input
          value={editedCmd}
          onChange={(e) => setEditedCmd(e.target.value)}
          className="mb-2 font-mono text-xs"
        />
      ) : (
        <code className="mb-2 block rounded-lg bg-muted p-2 text-xs text-foreground">
          {data.command}
        </code>
      )}

      <div className="mt-2 flex gap-2">
        <Button type="button" disabled={loading} onClick={() => handleAction(true)} size="sm">
          {loading && <Loader2 className="size-3.5 animate-spin" />}
          {!loading && <Check />}
          允许
        </Button>
        <Button
          type="button"
          disabled={loading}
          onClick={() => handleAction(false)}
          variant="destructive"
          size="sm"
        >
          {loading && <Loader2 className="size-3.5 animate-spin" />}
          {!loading && <X />}
          拒绝
        </Button>
        <Button
          type="button"
          disabled={loading}
          onClick={() => setEditing(!editing)}
          variant="outline"
          size="sm"
        >
          <Pencil />
          {editing ? '完成编辑' : '编辑'}
        </Button>
      </div>
    </div>
  );
}
