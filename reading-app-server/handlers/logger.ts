type LogMeta = Record<string, unknown>;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const stringifyMetaValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number'
    || typeof value === 'boolean'
    || value === null
    || value === undefined
  ) {
    return String(value);
  }

  return JSON.stringify(value);
};

const formatMeta = (meta: LogMeta): string => {
  const parts = Object.entries(meta)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${stringifyMetaValue(value)}`);

  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
};

/**
 * Formats and outputs a readable log entry to the console.
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
  const timestamp = new Date().toISOString();
  console.log(
    `[${timestamp}][${level}][${scope}] ${message}${formatMeta(meta)}`,
  );
};
