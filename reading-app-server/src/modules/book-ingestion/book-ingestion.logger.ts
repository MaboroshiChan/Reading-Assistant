import fs from 'node:fs/promises';
import path from 'node:path';

type BookIngestionLogMeta = Record<string, unknown>;

const DEFAULT_LOG_PATH = path.join(__dirname, '..', '..', '..', 'log', 'book-ingestion.log');

let writeChain: Promise<void> = Promise.resolve();

const resolveLogPath = (): string => {
  const configured = process.env.BOOK_INGESTION_LOG_FILE?.trim();
  return configured ? path.resolve(configured) : DEFAULT_LOG_PATH;
};

export const bookIngestionLog = (event: string, meta: BookIngestionLogMeta = {}): void => {
  const payload = {
    timestamp: new Date().toISOString(),
    scope: 'book-ingestion',
    event,
    ...meta,
  };
  const line = `${JSON.stringify(payload)}\n`;

  writeChain = writeChain
    .then(async () => {
      const logPath = resolveLogPath();
      await fs.mkdir(path.dirname(logPath), { recursive: true });
      await fs.appendFile(logPath, line, 'utf8');
    })
    .catch((error) => {
      console.warn('[book-ingestion-log] failed to persist log entry', error);
    });
};

export const flushBookIngestionLogs = async (): Promise<void> => {
  await writeChain;
};
