"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.set = exports.get = void 0;
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
exports.get = get;
function set(key, data, ttlMs) {
    cache.set(key, { data, expires: Date.now() + ttlMs });
}
exports.set = set;
//# sourceMappingURL=cache.js.map