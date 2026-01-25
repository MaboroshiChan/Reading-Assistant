const cache = new Map<string, { data: unknown; expires: number }>();

/**
 * Retrieves an item from the cache if it exists and hasn't expired.
 *
 * @param key - The cache key.
 * @returns The cached data cast to type T, or undefined if not found/expired.
 */
export function get<T>(key: string): T | undefined {
  const item = cache.get(key);
  if (!item) return;
  if (Date.now() > item.expires) {
    cache.delete(key);
    return;
  }
  return item.data as T;
}

export function set<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, expires: Date.now() + ttlMs });
}