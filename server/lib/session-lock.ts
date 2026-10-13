// Serialize queue mutations per room across HTTP routes and WebSocket queue handlers.
// The promise chain is process-local and always releases the next waiter, even on failure.
const sessionLockTails = new Map<string, Promise<void>>();

export async function withSessionLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
  const previous = sessionLockTails.get(sessionId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });

  sessionLockTails.set(sessionId, current);
  await previous;

  try {
    return await operation();
  } finally {
    release();
    if (sessionLockTails.get(sessionId) === current) {
      sessionLockTails.delete(sessionId);
    }
  }
}
