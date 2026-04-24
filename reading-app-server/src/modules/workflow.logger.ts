import fs from 'node:fs/promises';
import path from 'node:path';

type WorkflowLogMeta = Record<string, unknown>;

const DEFAULT_LOG_PATH = path.join(__dirname, '..', '..', 'log', 'workflows.log');
const TERMINAL_PRIMARY_KEYS = [
  'workflowKind',
  'workflowRunId',
  'bookId',
  'chapterId',
  'chapterIndex',
  'workflowVersion',
  'status',
  'reason',
  'errorCode',
  'errorMessage',
  'deduped',
  'resultAvailable',
  'snapshotVersion',
  'completedAt',
  'startedAt',
] as const;

let writeChain: Promise<void> = Promise.resolve();

const resolveLogPath = (): string => {
  const configured = process.env.WORKFLOW_LOG_FILE?.trim();
  return configured ? path.resolve(configured) : DEFAULT_LOG_PATH;
};

const stringifyValue = (value: unknown): string => {
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

const formatTerminalLine = (payload: Record<string, unknown>): string => {
  const prefix = `[${payload.timestamp}][workflow][${payload.event}]`;
  const parts: string[] = [];
  const consumed = new Set<string>(['timestamp', 'scope', 'event']);

  for (const key of TERMINAL_PRIMARY_KEYS) {
    const value = payload[key];
    if (value === undefined) continue;
    parts.push(`${key}=${stringifyValue(value)}`);
    consumed.add(key);
  }

  for (const [key, value] of Object.entries(payload)) {
    if (consumed.has(key) || value === undefined) continue;
    parts.push(`${key}=${stringifyValue(value)}`);
  }

  return parts.length > 0 ? `${prefix} ${parts.join(' ')}` : prefix;
};

export const workflowLog = (event: string, meta: WorkflowLogMeta = {}): void => {
  const payload = {
    timestamp: new Date().toISOString(),
    scope: 'workflow',
    event,
    ...meta,
  };
  const line = `${JSON.stringify(payload)}\n`;

  console.info(formatTerminalLine(payload));

  writeChain = writeChain
    .then(async () => {
      const logPath = resolveLogPath();
      await fs.mkdir(path.dirname(logPath), { recursive: true });
      await fs.appendFile(logPath, line, 'utf8');
    })
    .catch((error) => {
      console.warn('[workflow-log] failed to persist log entry', error);
    });
};

export const flushWorkflowLogs = async (): Promise<void> => {
  await writeChain;
};
