import type { ApproveRequest } from '../types';
import { apiFetch } from './client';

export async function approveTool(
  sessionId: string,
  toolApprovalId: string,
  approved: boolean,
  editedCommand?: string,
): Promise<void> {
  const body: ApproveRequest = {
    session_id: sessionId,
    tool_approval_id: toolApprovalId,
    approved,
    edited_command: editedCommand,
  };
  await apiFetch('/api/tool/approve', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
