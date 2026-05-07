// In-memory storage stub matching the prototype's window.storage API.
// Phase 4 swaps this for Supabase queries — same call sites, different impl.

export type StorageEntry = { value: string };

export type StorageStub = {
  get: (key: string) => Promise<StorageEntry | null>;
  set: (key: string, value: string) => Promise<void>;
};

declare global {
  interface Window {
    storage?: StorageStub;
  }
}

const memory = new Map<string, string>();

export const storageStub: StorageStub = {
  get: async (key) => {
    const value = memory.get(key);
    return value !== undefined ? { value } : null;
  },
  set: async (key, value) => {
    memory.set(key, value);
  },
};

/** Install the stub on `window.storage` so existing call sites work unchanged. */
export function installStorageStub(): void {
  if (typeof window !== "undefined" && !window.storage) {
    window.storage = storageStub;
  }
}
