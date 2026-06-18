import { ArrowUp } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useChatStore } from '../stores/chatStore';

interface ChatInputProps {
  onSend: (prompt: string) => void;
  centered?: boolean;
}

export function ChatInput({ onSend, centered }: ChatInputProps) {
  const [value, setValue] = useState('');
  const status = useChatStore((s) => s.status);
  const disabled = status === 'connecting' || status === 'streaming' || status === 'waiting';
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // 从禁用状态恢复时自动获取焦点
  const prevDisabled = useRef(disabled);
  useEffect(() => {
    if (prevDisabled.current && !disabled) {
      textareaRef.current?.focus();
    }
    prevDisabled.current = disabled;
  }, [disabled]);

  // 根据内容自动调整高度
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = value.trim().length > 0 && !disabled

  return (
    <div className={`w-full ${centered ? 'max-w-xl' : 'mx-auto max-w-[900px]'}`}>
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={status === 'waiting' ? '等待操作确认...' : '欢迎回来！'}
          disabled={disabled}
          rows={1}
          className="min-h-[152px] w-full resize-none rounded-2xl border border-border bg-white p-4 text-fg outline-none transition-colors placeholder:text-muted-fg/50 focus:border-amber-600/30 focus:ring-2 focus:ring-amber-600/10 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className="absolute bottom-4 right-4 flex size-8 items-center justify-center rounded-xl bg-amber-700 text-white transition-colors hover:bg-amber-600 disabled:opacity-30 disabled:hover:bg-amber-700"
        >
          <ArrowUp size={16} />
        </button>
      </div>
    </div>
  );
}
