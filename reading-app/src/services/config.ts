interface Config {
    apiBaseUrl: string;
    model: string;
    timeoutMs: number;
    cacheMax: number;
    cacheTtlMs: number;
    useMockLLM: boolean;
    debugMode: boolean;
    renderMode: boolean;
}

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
    model: getEnv("MODEL_ID", "gemini-2.5-flash"),
    timeoutMs: Number(getEnv("TIMEOUT_MS", "50000")),
    cacheMax: Number(getEnv("CACHE_MAX", "100")),
    cacheTtlMs: Number(getEnv("CACHE_TTL_MS", "3600000")),
    useMockLLM: getEnv("MOCK_LLM") === "1" || getEnv("TEST_MODE") === "1",
    debugMode: getEnv("DEBUG_MODE") === "1",
    renderMode: true
};

export default config;