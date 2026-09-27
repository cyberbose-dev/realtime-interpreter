import { getAccessToken, LoginRequired } from './auth.ts';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
  /** 4xx other than throttling will not succeed on retry. */
  get permanent() {
    return this.status >= 400 && this.status < 500 && this.status !== 429;
  }
}

let loginRequiredHandler = () => {};
export const onLoginRequired = (fn: () => void) => (loginRequiredHandler = fn);

export async function post<T>(op: string, body: unknown, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
  try {
    return await request<T>(op, body, opts);
  } catch (e) {
    if (e instanceof LoginRequired) loginRequiredHandler();
    throw e;
  }
}

async function request<T>(op: string, body: unknown, opts: { signal?: AbortSignal; timeoutMs?: number }): Promise<T> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  for (let attempt = 0; ; attempt++) {
    const token = await getAccessToken(attempt > 0);
    const res = await fetch(`/api/${op}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal,
    });
    if (res.status === 401 && attempt === 0) continue; // token expired early: refresh once
    if (res.status === 401) throw new LoginRequired();
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}) as { error?: string });
      throw new HttpError(res.status, (detail as { error?: string }).error ?? res.statusText);
    }
    return (await res.json()) as T;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const waitOnline = () =>
  navigator.onLine ? Promise.resolve() : new Promise<void>((r) => addEventListener('online', () => r(), { once: true }));

/** Retries network errors and 5xx/429 with backoff, waiting while the browser is offline. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 0; ; i++) {
    await waitOnline();
    try {
      return await fn();
    } catch (e) {
      if (e instanceof LoginRequired || (e instanceof HttpError && e.permanent) || i >= attempts - 1) throw e;
      await sleep(Math.min(8000, 500 * 2 ** i) + Math.random() * 300);
    }
  }
}
