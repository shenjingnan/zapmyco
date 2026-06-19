import { ChatInput } from './ChatInput';

interface EmptyStateProps {
  onSend: (prompt: string) => void;
}

export function EmptyState({ onSend }: EmptyStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="w-full text-center">
        <p className="mb-6 text-xl font-medium text-fg/85">欢迎回来！</p>
        <div className="flex justify-center">
          <ChatInput onSend={onSend} centered />
        </div>
      </div>
    </div>
  );
}
