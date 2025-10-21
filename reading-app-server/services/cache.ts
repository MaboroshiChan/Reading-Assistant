const cache = new Map<string, { data: unknown; expires: number }>();

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