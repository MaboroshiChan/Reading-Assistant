export function createAbortError(message = 'Operation aborted'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof DOMException) {
    return error.name === 'AbortError';
  }
  if (error instanceof Error) {
    if (error.name === 'AbortError') return true;
    return /\babort(ed|ing)?\b/i.test(error.message);
  }
  return false;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }
  throw createAbortError(
    typeof reason === 'string' && reason.trim().length > 0
      ? reason
      : 'Operation aborted',
  );
}
