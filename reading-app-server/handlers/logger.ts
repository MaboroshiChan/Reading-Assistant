type LogMeta = Record<string, unknown>;

export const handlerLog = (scope: string, message: string, meta?: LogMeta): void => {
  const payload = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[handler:${scope}] ${message}${payload}`);
};

