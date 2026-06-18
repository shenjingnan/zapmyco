import { useCallback, useEffect, useRef } from 'react';

export function useAutoScroll(deps: unknown[]) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    userScrolledUp.current = !atBottom;
  }, []);

  useEffect(() => {
    if (!userScrolledUp.current && anchorRef.current) {
      anchorRef.current.scrollIntoView({ behavior: 'smooth' });
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: dynamic deps for custom hook
  }, deps);

  return { anchorRef, containerRef, handleScroll };
}
