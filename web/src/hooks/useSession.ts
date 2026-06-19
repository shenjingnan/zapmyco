import { useCallback, useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';

const SESSION_KEY = 'zapmyco_session_id';

export function useSession() {
  const sessionId = useChatStore((s) => s.sessionId);
  const setSessionId = useChatStore((s) => s.setSessionId);

  // 页面加载时从 sessionStorage 恢复 sessionId
  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) {
      setSessionId(saved);
    }
  }, [setSessionId]);

  const updateSessionId = useCallback(
    (id: string) => {
      setSessionId(id);
      sessionStorage.setItem(SESSION_KEY, id);
    },
    [setSessionId],
  );

  return { sessionId, updateSessionId };
}
