import { ext } from '../shared/browser-api';

/**
 * Storage abstraction.
 *
 * `chrome.storage.local` (also exposed as `browser.storage.local` in Firefox) is
 * the extension's own origin-isolated store: web pages cannot read it, and it is
 * never uploaded. A memory implementation keeps the logic testable in Node.
 */
export interface StorageArea {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
}

export class MemoryStorageArea implements StorageArea {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    if (!this.values.has(key)) return undefined;
    return structuredClone(this.values.get(key)) as T;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value));
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }

  async clear(): Promise<void> {
    this.values.clear();
  }

  async keys(): Promise<string[]> {
    return [...this.values.keys()];
  }
}

export function createBrowserStorageArea(): StorageArea {
  const area = ext.storage.local;
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const record = (await area.get(key)) as Record<string, unknown>;
      return record[key] as T | undefined;
    },
    async set(key: string, value: unknown): Promise<void> {
      await area.set({ [key]: value });
    },
    async remove(key: string): Promise<void> {
      await area.remove(key);
    },
    async clear(): Promise<void> {
      await area.clear();
    },
    async keys(): Promise<string[]> {
      const record = (await area.get(null)) as Record<string, unknown>;
      return Object.keys(record);
    },
  };
}
