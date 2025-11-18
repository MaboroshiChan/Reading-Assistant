type LogMeta = Record<string, unknown>;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const handlerLog = (
  scope: string,
  message: string,
  meta: LogMeta = {},
  level: LogLevel = 'info',
): void => {
  const payload = {
    level,
    scope,
    message,
    ...meta,
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(payload));
};
