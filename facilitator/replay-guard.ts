/**
 * ReplayGuard - nonce/expiry/replay protection
 *
 * Tracks used nonces to prevent replay attacks.
 * In-memory store with optional Redis adapter.
 */

export interface ReplayGuardOptions {
  /** Default TTL in seconds for nonce entries (default: 3600) */
  defaultTtlSeconds?: number;
  /** Optional Redis URL for distributed nonce tracking */
  redisUrl?: string;
}

export class ReplayGuard {
  private usedNonces: Map<string, number> = new Map();
  private defaultTtl: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: ReplayGuardOptions = {}) {
    this.defaultTtl = (options.defaultTtlSeconds ?? 3600) * 1000;

    // Periodic cleanup every 60 seconds
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Check if a nonce has already been used
   */
  isNonceUsed(nonce: string): boolean {
    const expiry = this.usedNonces.get(nonce);
    if (expiry === undefined) return false;

    // If expired, treat as unused and clean up
    if (Date.now() > expiry) {
      this.usedNonces.delete(nonce);
      return false;
    }

    return true;
  }

  /**
   * Mark a nonce as used with an optional expiry
   * @param nonce - The nonce string
   * @param expiryMs - Optional absolute expiry timestamp in ms. Defaults to now + defaultTtl.
   */
  markNonceUsed(nonce: string, expiryMs?: number): void {
    const expiry = expiryMs ?? Date.now() + this.defaultTtl;
    this.usedNonces.set(nonce, expiry);
  }

  /**
   * Check if a timestamp-based expiry has passed
   */
  isExpired(validBefore: string | number): boolean {
    const expiryTimestamp =
      typeof validBefore === "string" ? parseInt(validBefore, 10) : validBefore;

    // x402 uses seconds; convert to ms if needed
    const expiryMs = expiryTimestamp > 1e12 ? expiryTimestamp : expiryTimestamp * 1000;

    return Date.now() > expiryMs;
  }

  /**
   * Remove expired nonces from the store
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [nonce, expiry] of this.usedNonces.entries()) {
      if (now > expiry) {
        this.usedNonces.delete(nonce);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get the number of tracked nonces
   */
  get size(): number {
    return this.usedNonces.size;
  }

  /**
   * Destroy the replay guard, clearing timers
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.usedNonces.clear();
  }
}
