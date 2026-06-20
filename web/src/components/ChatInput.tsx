import { ArrowUp } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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
  const [hasContent, setHasContent] = useState(false);
  const status = useChatStore((s) => s.status);
  const disabled =
    forceDisabled ?? (status === 'connecting' || status === 'streaming' || status === 'waiting');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const rafRef = useRef(0);

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

  // 自动调整高度
  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const handleSend = () => {
    const el = textareaRef.current;
    if (!el) return;
    const trimmed = el.value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    el.value = '';
    setHasContent(false);
    autoResize();
    el.focus();
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    setHasContent(el.value.trim().length > 0);

    // 推迟 resize 到下一帧，避免输入时强制读取布局
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = hasContent && !disabled;

  return (
    <div className="relative w-full">
      <Textarea
        ref={textareaRef}
        defaultValue=""
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? (status === 'waiting' ? '等待操作确认...' : '欢迎回来！')}
        disabled={disabled}
        rows={1}
        className={`resize-none rounded-xl bg-background p-4 placeholder:text-muted-foreground/50 focus-visible:ring-ring/10 ${compact ? 'min-h-[56px]' : 'min-h-[152px]'}`}
      />
      <Button
        type="button"
        onClick={handleSend}
        disabled={!canSend}
        size="icon"
        className="absolute bottom-3 right-4 transition-none"
      >
        <ArrowUp />
      </Button>
    </div>
  );
}
