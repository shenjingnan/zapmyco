import { Folder } from 'lucide-react';
import { useChatStore } from '../stores/chatStore';

export function CwdIndicator() {
  const currentDir = useChatStore((s) => s.currentDir);

  if (!currentDir) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-1.5 text-xs text-foreground/80">
      <Folder className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate font-mono" title={currentDir}>
        {currentDir}
      </span>
    </div>
  );
}
