export type PersistRetryOptions = {
  attempts?: number;
  delaysMs?: number[];
  label?: string;
};

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_DELAYS_MS = [50, 150, 400];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function persistWithRetry<T>(fn: () => Promise<T>, opts?: PersistRetryOptions): Promise<T> {
  const attempts = opts?.attempts ?? DEFAULT_ATTEMPTS;
  const delaysMs = opts?.delaysMs ?? DEFAULT_DELAYS_MS;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts - 1) {
        const waitMs = delaysMs[attempt] ?? delaysMs[delaysMs.length - 1] ?? 0;
        await delay(waitMs);
      }
    }
  }

  throw lastError;
}
