type BookIngestionLogMeta = Record<string, unknown>;

const shouldMirrorToStdout = (): boolean => {
  const configured = process.env.BOOK_INGESTION_LOG_STDOUT?.trim().toLowerCase();
  if (configured === '1' || configured === 'true') return true;
  if (configured === '0' || configured === 'false') return false;
  return process.env.NODE_ENV === 'production';
};

export const bookIngestionLog = (event: string, meta: BookIngestionLogMeta = {}): void => {
  const payload = {
    timestamp: new Date().toISOString(),
    scope: 'book-ingestion',
    event,
    ...meta,
  };
  const line = `${JSON.stringify(payload)}\n`;

  if (shouldMirrorToStdout()) {
    process.stdout.write(line);
  }
};

export const flushBookIngestionLogs = async (): Promise<void> => {};
