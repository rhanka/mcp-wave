import pRetry, { AbortError, type Options as PRetryOptions } from "p-retry";
import { WaveApiError } from "./errors.js";

const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EPIPE",
  "EAI_AGAIN",
]);

export function isRetryable(e: unknown): boolean {
  if (e instanceof WaveApiError) {
    if (e.httpStatus === 429) return true;
    if (e.httpStatus >= 500) return true;
    return false;
  }
  if (e instanceof TypeError) return true;
  if (e instanceof Error) {
    const code = (e as Error & { code?: string }).code;
    if (code && NETWORK_CODES.has(code)) return true;
  }
  return false;
}

export function withRetry<T>(fn: () => Promise<T>, opts?: Partial<PRetryOptions>): Promise<T> {
  return pRetry(
    async () => {
      try {
        return await fn();
      } catch (e) {
        if (!isRetryable(e)) {
          throw new AbortError(e instanceof Error ? e : new Error(String(e)));
        }
        throw e;
      }
    },
    {
      retries: 3,
      factor: 2,
      minTimeout: 500,
      maxTimeout: 5000,
      randomize: true,
      ...opts,
    },
  );
}
