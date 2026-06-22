import { Folder } from 'lucide-react';
import { useChatStore } from '../stores/chatStore';

export function CwdIndicator() {
  const currentDir = useChatStore((s) => s.currentDir);

  if (!currentDir) return null;

  return (
    <div className="flex items-center gap-1.5">
      <Folder className="size-3 shrink-0" />
      <span className="max-w-[400px] truncate font-mono" title={currentDir}>
        {currentDir}
      </span>
    </div>
  );
}
