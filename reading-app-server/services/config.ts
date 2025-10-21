export const config = {
  port: Number(process.env.PORT ?? 8787),
  model: process.env.MODEL_ID ?? "gpt-4o-mini",
  apiKey: process.env.OPENAI_API_KEY ?? "",
  timeoutMs: 15000,
  cacheMax: 500,
  cacheTtlMs: 7 * 24 * 3600_000, // 7d
};

