import { ext } from '../shared/browser-api';
import type { MessageResponse, UiMessage } from '../shared/messages';

/** Promise-based message client shared by the popup, dashboard and options. */

export async function send<T>(message: UiMessage): Promise<T> {
  const response = (await ext.runtime.sendMessage(message)) as MessageResponse<T> | undefined;
  if (response === undefined) {
    throw new Error('The LeetSensei background worker did not respond. Reload the extension.');
  }
  if (!response.ok) {
    throw new Error(response.error);
  }
  return response.data;
}

export function openPage(page: 'dashboard' | 'options'): void {
  void ext.tabs.create({ url: ext.runtime.getURL(`${page}.html`) });
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
