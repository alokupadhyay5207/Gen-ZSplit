/**
 * Sliding-window limiter for guessable secrets (group passwords): 5 failures per
 * 10 minutes, then a lockout.
 *
 * In-memory and per-process, exactly like the Flask original. On serverless hosting each
 * warm instance keeps its own counter, so treat this as a speed bump, not a hard limit. For a
 * hard limit move the counters to a shared store (Redis / a Supabase table).
 */
export class FailureThrottle {
  private hits = new Map<string, number[]>();

  constructor(
    private limit = 5,
    private windowMs = 600_000,
  ) {}

  private prune(key: string): number[] {
    const cutoff = Date.now() - this.windowMs;
    const q = (this.hits.get(key) ?? []).filter((t) => t >= cutoff);
    if (q.length) this.hits.set(key, q);
    else this.hits.delete(key);
    return q;
  }

  /** Seconds until another attempt is allowed (0 when not locked out). */
  retryAfter(key: string): number {
    const q = this.prune(key);
    if (q.length < this.limit) return 0;
    return Math.max(1, Math.ceil((q[0] + this.windowMs - Date.now()) / 1000));
  }

  recordFailure(key: string): void {
    const q = this.prune(key);
    q.push(Date.now());
    this.hits.set(key, q);
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}

export const joinThrottle = new FailureThrottle(5, 600_000);
