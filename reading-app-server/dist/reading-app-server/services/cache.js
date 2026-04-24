"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.get = get;
exports.set = set;
const cache = new Map();
/**
 * Retrieves an item from the cache if it exists and hasn't expired.
 *
 * @param key - The cache key.
 * @returns The cached data cast to type T, or undefined if not found/expired.
 */
function get(key) {
    const item = cache.get(key);
    if (!item)
        return;
    if (Date.now() > item.expires) {
        cache.delete(key);
        return;
    }
    return item.data;
}
function set(key, data, ttlMs) {
    cache.set(key, { data, expires: Date.now() + ttlMs });
}
//# sourceMappingURL=cache.js.map