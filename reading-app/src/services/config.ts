interface Config {
    apiBaseUrl: string;
    model: string;
    timeoutMs: number;
    cacheMax: number;
    cacheTtlMs: number;
    debugMode: boolean;
}

/**
 * Retrieves an environment variable, supporting both Vite and Webpack/CRA styles.
 *
 * @param key - The environment variable name.
 * @param defaultValue - Fallback if not found.
 * @returns The resolved value or default.
 */
const getEnv = (key: string, defaultValue: string = ""): string => {
    // Support for Vite (import.meta.env)
    try {
        if (typeof import.meta !== 'undefined' && import.meta.env) {
            const val = import.meta.env[key] || import.meta.env[`VITE_${key}`];
            if (val !== undefined) return String(val);
        }
    } catch {
        // ignore 
    }

    // Support for Webpack/CRA (process.env)
    if (typeof process !== 'undefined' && process.env) {
        const val = process.env[key] || process.env[`REACT_APP_${key}`];
        if (val !== undefined) return String(val);
    }
    return defaultValue;
};

export const config: Config = {
    apiBaseUrl: getEnv("API_BASE_URL", "http://localhost:8787"),
    model: getEnv("MODEL_ID", "gemma-3-27b-it"),
    timeoutMs: Number(getEnv("TIMEOUT_MS", "50000")),
    cacheMax: Number(getEnv("CACHE_MAX", "100")),
    cacheTtlMs: Number(getEnv("CACHE_TTL_MS", "3600000")),
    debugMode: getEnv("DEBUG_MODE") === "1"
};

export default config;
