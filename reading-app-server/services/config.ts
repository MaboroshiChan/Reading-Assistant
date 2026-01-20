export interface Config {
  port: number;
  model: string;
  timeoutMs: number;
  cacheMax: number;
  cacheTtlMs: number;
  useMockLLM: boolean;
  debugMode: boolean;
}

export const config: Config = {
  port: Number(process.env.PORT ?? 8787),
  model: process.env.MODEL_ID ?? "gemini-2.5-flash",
  timeoutMs: 50_000,
  cacheMax: 500,
  cacheTtlMs: 7 * 24 * 3600_000,
  useMockLLM: process.env.MOCK_LLM === '1' || process.env.NODE_ENV === 'test',
  debugMode: process.env.LLM_DEBUG === '1' || process.env.DEBUG_LLM === '1',
};

/**
 * Retrieves the API key for the LLM service.
 * Honors both OpenAI and Gemini naming conventions if applicable.
 *
 * @returns The API key string.
 */
export function getOpenAIApiKey(): string {
  return process.env.GEMINI_API_KEY ?? "";
}
