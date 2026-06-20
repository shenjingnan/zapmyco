import { Check, Loader2, Pencil, X } from 'lucide-react';
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
      <div
        className="self-center max-w-[85%] w-full rounded-xl border border-border bg-white p-4"
        style={{ borderLeft: '3px solid #695e54' }}
      >
        <div className="text-xs text-muted-fg">工具已处理</div>
        <code className="mt-1 block text-xs">{data.command}</code>
      </div>
    );
  }

  return (
    <div
      className="self-center max-w-[85%] w-full rounded-xl border border-border bg-white p-4"
      style={{ borderLeft: '3px solid #695e54' }}
    >
      <div className="mb-3 text-xs font-medium">⚠️ 需要审批 - {data.tool}</div>

      {data.description && <p className="mb-2 text-xs text-muted-fg">{data.description}</p>}

      {editing ? (
        <input
          value={editedCmd}
          onChange={(e) => setEditedCmd(e.target.value)}
          className="mb-2 w-full rounded-lg border border-border bg-white px-2.5 py-1.5 font-mono text-xs text-fg outline-none transition-colors focus:border-amber-600/30 focus:ring-2 focus:ring-amber-600/10"
        />
      ) : (
        <code className="mb-2 block rounded-lg bg-code-bg p-2 text-xs text-fg">{data.command}</code>
      )}

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={loading}
          onClick={() => handleAction(true)}
          className="inline-flex items-center gap-1 rounded-lg bg-amber-700 px-3 py-1.5 text-xs text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading && <Loader2 className="size-3.5 animate-spin" />}
          {!loading && <Check size={14} />}
          允许
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => handleAction(false)}
          className="inline-flex items-center gap-1 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading && <Loader2 className="size-3.5 animate-spin" />}
          {!loading && <X size={14} />}
          拒绝
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => setEditing(!editing)}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-3 py-1.5 text-xs text-fg transition-colors hover:bg-amber-50/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Pencil size={14} />
          {editing ? '完成编辑' : '编辑'}
        </button>
      </div>
    </div>
  );
}
