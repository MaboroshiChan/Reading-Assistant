type WorkflowLogMeta = Record<string, unknown>;
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
};

export const flushWorkflowLogs = async (): Promise<void> => {};
