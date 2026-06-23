import { CwdIndicator } from './CwdIndicator';

export function StatusBar() {
  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-muted/60 px-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-3">
        <CwdIndicator />
      </div>
      <div className="flex items-center gap-3" />
    </div>
  );
}
