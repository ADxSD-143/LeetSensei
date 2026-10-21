import type { ErrorCode } from './errors';

/** Message protocol between content script, background, and extension pages. */

export interface SyncStatusReport {
  phase: 'idle' | 'detected' | 'planning' | 'awaiting-decision' | 'uploading' | 'done' | 'failed';
  submissionId: string | null;
  problemTitle: string | null;
  problemSlug: string | null;
  categories: string[];
  message: string;
  errorCode: ErrorCode | null;
  updatedAt: string;
  /** Per-category outcome, used to render partial-success states. */
  perCategory: { category: string; ok: boolean; error: string | null }[];
}

export type UiMessage =
  | { type: 'submission/accepted'; payload: unknown }
  | { type: 'sync/status-request' }
  | {
      type: 'sync/conflict-decision';
      payload: { path: string; decision: 'replace' | 'save-version' | 'cancel' };
    }
  | { type: 'sync/retry' }
  | { type: 'revision/review'; payload: { problemId: string; rating: 'again' | 'hard' | 'easy' } }
  | { type: 'revision/set-next'; payload: { problemId: string; nextReviewAt: string } }
  | { type: 'revision/backup' }
  | { type: 'data/overview' }
  | { type: 'data/diagnostics' }
  | { type: 'github/device-start'; payload: { scope: string } }
  | { type: 'github/device-poll'; payload: { deviceCode: string } }
  | { type: 'github/pat-save'; payload: { token: string } }
  | { type: 'github/verify' }
  | { type: 'github/list-repos' }
  | { type: 'github/list-branches'; payload: { owner: string; repo: string } }
  | {
      type: 'github/check-access';
      payload: { owner: string; repo: string; branch: string };
    }
  | { type: 'settings/save'; payload: unknown }
  | { type: 'settings/load' }
  | { type: 'data/restore' }
  | { type: 'data/clear' }
  | { type: 'data/disconnect' }
  | { type: 'data/export' };

export type MessageResponse<T = unknown> =
  { ok: true; data: T } | { ok: false; error: string; code: ErrorCode };

export function isUiMessage(value: unknown): value is UiMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { type?: unknown };
  return typeof candidate.type === 'string';
}

export const MESSAGE_TYPES: readonly UiMessage['type'][] = [
  'submission/accepted',
  'sync/status-request',
  'sync/conflict-decision',
  'sync/retry',
  'revision/review',
  'revision/set-next',
  'revision/backup',
  'data/overview',
  'data/diagnostics',
  'github/device-start',
  'github/device-poll',
  'github/pat-save',
  'github/verify',
  'github/list-repos',
  'github/list-branches',
  'github/check-access',
  'settings/save',
  'settings/load',
  'data/restore',
  'data/clear',
  'data/disconnect',
  'data/export',
];
