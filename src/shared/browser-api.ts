/**
 * Cross-browser WebExtension API access.
 *
 * Chromium exposes `chrome` with promise-returning MV3 APIs; Firefox exposes
 * `browser` with promise-returning APIs. Preferring `browser` when present and
 * falling back to `chrome` gives one awaitable surface in both engines.
 *
 * Importing this module is always safe. If no extension API exists (unit tests
 * running in Node) the exported object throws a clear error the moment it is
 * used, instead of exploding during module evaluation.
 */

const globalScope = globalThis as unknown as Record<string, unknown>;

export const isFirefox: boolean = typeof globalScope.browser !== 'undefined';

function missingApi(): never {
  throw new Error(
    'LeetSensei needs a WebExtension environment: neither `browser` nor `chrome` is available.',
  );
}

const nativeApi = (globalScope.browser ?? globalScope.chrome) as typeof chrome | undefined;

export const ext: typeof chrome =
  nativeApi ?? (new Proxy({}, { get: missingApi }) as unknown as typeof chrome);

export function runtimeGetUrl(path: string): string {
  return ext.runtime.getURL(path);
}
