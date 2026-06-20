import { ArrowUp } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useChatStore } from '../stores/chatStore';

interface ChatInputProps {
  onSend: (prompt: string) => void;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
}

export function ChatInput({
  onSend,
  placeholder,
  disabled: forceDisabled,
  compact,
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const status = useChatStore((s) => s.status);
  const disabled =
    forceDisabled ?? (status === 'connecting' || status === 'streaming' || status === 'waiting');
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: value triggers auto-resize on content change
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

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <div className="relative w-full">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? (status === 'waiting' ? '等待操作确认...' : '欢迎回来！')}
        disabled={disabled}
        rows={1}
        className={`w-full resize-none rounded-xl border border-border bg-background p-4 text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/10 disabled:cursor-not-allowed disabled:opacity-50 ${compact ? 'min-h-[56px]' : 'min-h-[152px]'}`}
      />
      <Button
        type="button"
        onClick={handleSend}
        disabled={!canSend}
        size="icon"
        className="absolute bottom-4 right-4"
      >
        <ArrowUp />
      </Button>
    </div>
  );
}
