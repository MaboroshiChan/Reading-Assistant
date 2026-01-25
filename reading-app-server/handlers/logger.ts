type LogMeta = Record<string, unknown>;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Formats and outputs a log entry in JSON format to the console.
 *
 * @param scope - The area or feature responsible for the log.
 * @param message - The main log message.
 * @param meta - Additional metadata to include in the log entry.
 * @param level - The severity level of the log.
 */
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
