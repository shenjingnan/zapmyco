import type { ChatRequest } from '../types'
import { chatFetch } from './client'

export function sendChatMessage(
  prompt: string,
  sessionId: string | null,
): Promise<Response> {
  const body: ChatRequest = {
    prompt,
    session_id: sessionId,
  }
  return chatFetch('/api/chat', body)
}
