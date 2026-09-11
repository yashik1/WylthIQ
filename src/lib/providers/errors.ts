/**
 * Why a provider call failed, in a handful of words the rest of the app can act on.
 *
 * Providers fail in wildly different vocabularies — one says "You have run out
 * of API credits", another answers 429, a third returns an HTML error page —
 * and until now every failure was carried as the provider's own sentence. That
 * is fine for a human reading a log and useless for code deciding what to tell
 * a reader. These categories are the common language.
 */

export type ProviderErrorCategory =
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NOT_FOUND"
  | "PROVIDER_ERROR"
  | "INVALID_DATA"
  | "NO_DATA";

export class ProviderTimeoutError extends Error {
  constructor(provider: string, ms: number) {
    super(`${provider} did not answer within ${ms}ms`);
    this.name = "ProviderTimeoutError";
  }
}

export function classifyProviderError(err: unknown): ProviderErrorCategory {
  if (err instanceof ProviderTimeoutError) return "TIMEOUT";

  const name = err instanceof Error ? err.name : "";
  const message = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  const rawStatus = (err as { status?: unknown } | null)?.status;
  const status = typeof rawStatus === "number" ? rawStatus : null;

  if (name === "AbortError" || name === "TimeoutError" || /timed? ?out|etimedout|econnaborted/.test(message)) {
    return "TIMEOUT";
  }
  if (
    status === 429 ||
    /\b429\b|rate.?limit|too many requests|quota|out of (api )?credits|run out|limit (reached|exceeded)/.test(message)
  ) {
    return "RATE_LIMITED";
  }
  if (status === 404 || /\b404\b|not found|unknown symbol|invalid symbol|no such (symbol|ticker)/.test(message)) {
    return "NOT_FOUND";
  }
  if (name === "SyntaxError" || /unexpected token|invalid json|malformed|unexpected response/.test(message)) {
    return "INVALID_DATA";
  }
  if (/no data|returned no|empty response|no quote/.test(message)) return "NO_DATA";
  return "PROVIDER_ERROR";
}

/**
 * Gives up on a provider call after `ms`.
 *
 * Applied at the failover layer rather than inside each provider, so every
 * source gets the same ceiling and a hung connection moves on to the next
 * provider instead of holding the page. The abandoned call is simply ignored.
 */
export function withTimeout<T>(work: Promise<T>, ms: number, provider: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProviderTimeoutError(provider, ms)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
