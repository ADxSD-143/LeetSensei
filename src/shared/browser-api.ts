/**
 * Cross-browser WebExtension API access.
 *
 * Chromium exposes `chrome` with promise-returning MV3 APIs; Firefox exposes
 * `browser` with promise-returning APIs. Preferring `browser` when present and
 * falling back to `chrome` gives one awaitable surface in both engines.
 */

const globalScope = globalThis as unknown as Record<string, unknown>;

export const isFirefox: boolean = typeof globalScope.browser !== 'undefined';

export const ext: typeof chrome = (globalScope.browser ?? globalScope.chrome) as typeof chrome;

export const extensionApi = {
  storage: ext.storage,
  runtime: ext.runtime,
  alarms: ext.alarms,
  tabs: ext.tabs,
  action: ext.action,
  scripting: ext.scripting,
};

export function runtimeGetUrl(path: string): string {
  return ext.runtime.getURL(path);
}

export function openExtensionPage(page: 'dashboard' | 'options'): void {
  const url = runtimeGetUrl(`${page}.html`);
  void ext.tabs.create({ url });
}
