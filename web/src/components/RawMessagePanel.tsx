import { useCallback, useEffect, useRef } from 'react';
import { useChatStore } from '../stores/chatStore';

const TYPE_COLORS: Record<string, string> = {
  text: 'bg-blue-200 text-blue-800',
  text_delta: 'bg-blue-100 text-blue-700',
  status: 'bg-gray-300 text-gray-700',
  tool_call: 'bg-purple-200 text-purple-800',
  tool_progress: 'bg-purple-100 text-purple-700',
  tool_result: 'bg-purple-200 text-purple-800',
  tool_approval_required: 'bg-purple-300 text-purple-900',
  ask_user: 'bg-orange-200 text-orange-800',
  done: 'bg-gray-300 text-gray-600',
  error: 'bg-red-200 text-red-800',
};

function getTypeColor(type: string): string {
  return TYPE_COLORS[type] ?? 'bg-gray-200 text-gray-600';
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

function formatJSON(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function RawMessagePanel() {
  const rawEvents = useChatStore((s) => s.rawEvents);
  const clearRawEvents = useChatStore((s) => s.clearRawEvents);
  const listRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  // 自动滚动到最新
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const threshold = 40;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  useEffect(() => {
    if (rawEvents.length >= 0 && isAtBottomRef.current) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [rawEvents]);

  return (
    <div className="flex h-screen w-[380px] flex-shrink-0 flex-col border-l border-border bg-card">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-fg">原始消息</span>
          <span className="text-xs text-muted-fg">{rawEvents.length}</span>
        </div>
        <button
          type="button"
          className="text-xs text-muted-fg hover:text-fg"
          onClick={clearRawEvents}
        >
          清空
        </button>
      </div>

      {/* 事件列表 */}
      <div ref={listRef} className="flex-1 overflow-y-auto" onScroll={handleScroll}>
        {rawEvents.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <span className="text-xs text-muted-fg">暂无消息</span>
          </div>
        )}
        {rawEvents.map((ev, idx) => (
          <div key={ev.id}>
            {idx > 0 && idx % 10 === 0 && <div className="border-t border-border/50" />}
            <div className="px-3 py-1.5 hover:bg-black/5">
              <div className="mb-0.5 flex items-center gap-2">
                <span className="text-xs text-muted-fg tabular-nums">
                  {formatTime(ev.timestamp)}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${getTypeColor(ev.type)}`}
                >
                  {ev.type}
                </span>
              </div>
              <pre className="overflow-x-auto text-xs leading-relaxed text-fg/80">
                {formatJSON(ev.data)}
              </pre>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
