const sessionLocks = new Map<string, Promise<any>>();

/**
 * Ensures sequential execution of asynchronous operations for a given session.
 * Protects queue position calculation, status transitions, and playback triggers
 * against concurrent race conditions.
 */
export function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionLocks.get(sessionId) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  sessionLocks.set(sessionId, next);
  next.finally(() => {
    if (sessionLocks.get(sessionId) === next) {
      sessionLocks.delete(sessionId);
    }
  });
  return next;
}
