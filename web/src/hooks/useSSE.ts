import { useCallback, useRef } from 'react';
import { sendChatMessage } from '../api/chat';
import { useChatStore } from '../stores/chatStore';
import type { SSEEvent } from '../types';

function isSSEData(line: string): boolean {
  return line.startsWith('data: ');
}

function parseSSELine(line: string): SSEEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
  if (jsonStr === '[DONE]') return null;

  try {
    return JSON.parse(jsonStr) as SSEEvent;
  } catch {
    console.warn('SSE parse error:', jsonStr);
    return null;
  }
}

export function useSSE() {
  const abortRef = useRef<AbortController | null>(null);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const updateAssistantText = useChatStore((s) => s.updateAssistantText);
  const setStatus = useChatStore((s) => s.setStatus);
  const setSessionId = useChatStore((s) => s.setSessionId);
  const addToolApproval = useChatStore((s) => s.addToolApproval);
  const addAskUser = useChatStore((s) => s.addAskUser);
  const addError = useChatStore((s) => s.addError);
  const finalizeAssistantMessage = useChatStore((s) => s.finalizeAssistantMessage);

  const dispatchEvent = useCallback(
    (event: SSEEvent) => {
      switch (event.type) {
        case 'text':
          appendMessage({
            id: `msg_${Date.now()}`,
            role: 'assistant',
            content: event.content,
            timestamp: Date.now(),
          });
          break;
        case 'text_delta':
          updateAssistantText(event.content);
          break;
        case 'status':
          if (event.content.startsWith('session_id:')) {
            setSessionId(event.content.split(':')[1].trim());
          } else {
            appendMessage({
              id: `msg_${Date.now()}`,
              role: 'system',
              content: event.content,
              timestamp: Date.now(),
            });
          }
          break;
        case 'tool_approval_required':
          addToolApproval({
            id: event.id,
            tool: event.tool,
            command: event.command,
            description: event.description,
          });
          break;
        case 'ask_user':
          addAskUser({
            id: event.id,
            question: event.question,
            options: event.options,
          });
          break;
        case 'tool_progress':
          setStatus('streaming');
          break;
        case 'tool_call':
        case 'tool_result':
          // 后台操作，不需要前端特别处理
          break;
        case 'done':
          finalizeAssistantMessage();
          setStatus('done');
          break;
        case 'error':
          addError({ code: event.code, message: event.message });
          break;
      }
    },
    [
      appendMessage,
      updateAssistantText,
      setStatus,
      setSessionId,
      addToolApproval,
      addAskUser,
      addError,
      finalizeAssistantMessage,
    ],
  );

  const startStream = useCallback(
    async (prompt: string, sessionId: string | null) => {
      // 添加用户消息
      appendMessage({
        id: `msg_${Date.now()}`,
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
      });

      setStatus('connecting');

      abortRef.current = new AbortController();

      try {
        const response = await sendChatMessage(prompt, sessionId);
        setStatus('streaming');

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!isSSEData(line) && line.trim()) {
              // 也可能是直接用 JSON 行的格式
              const event = parseSSELine(line);
              if (event) dispatchEvent(event);
            } else if (isSSEData(line)) {
              const event = parseSSELine(line);
              if (event) dispatchEvent(event);
            }
          }
        }

        // 处理最后 buffer 中剩余的内容
        if (buffer.trim()) {
          const event = parseSSELine(buffer);
          if (event) dispatchEvent(event);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          setStatus('idle');
          return;
        }
        addError({
          code: 'NETWORK_ERROR',
          message: err instanceof Error ? err.message : '连接失败',
        });
      }
    },
    [appendMessage, setStatus, addError, dispatchEvent],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  return { startStream, abort };
}
