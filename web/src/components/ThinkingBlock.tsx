import { useState } from 'react';
import { ChevronDown, ChevronRight, Brain } from 'lucide-react';

interface ThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
}

export function ThinkingBlock({ content, isStreaming }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-l-2 border-zinc-300 dark:border-zinc-600 pl-3 my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Brain size={14} />
        <span>Thinking</span>
        {isStreaming && <span className="animate-pulse">▊</span>}
      </button>
      {expanded && (
        <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400 italic whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  );
}
