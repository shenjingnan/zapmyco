import type { AskRespondRequest } from '../types'
import { apiFetch } from './client'

export async function respondToAsk(
  sessionId: string,
  askId: string,
  selectedIdx?: number,
  customText?: string,
): Promise<void> {
  const body: AskRespondRequest = {
    session_id: sessionId,
    ask_id: askId,
    selected_idx: selectedIdx,
    custom_text: customText,
  }
  await apiFetch('/api/ask/respond', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
