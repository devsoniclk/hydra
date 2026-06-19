/**
 * FailoverClient - health-check + auto-failover router
 *
 * Wraps multiple facilitator endpoints and automatically routes
 * around failures using circuit breaker pattern.
 */

import { EventEmitter } from "events";
import type {
  PaymentPayload,
  SettleResult,
  VerifyResult,
  FailoverConfig,
  FailoverEvents,
} from "../facilitator/types.js";

interface FacilitatorState {
  url: string;
  healthy: boolean;
  failures: number;
  lastFailure: number;
  lastHealthCheck: number;
  circuitOpenUntil: number;
}

export class FailoverClient extends EventEmitter {
  private facilitators: Map<string, FacilitatorState> = new Map();
  private healthcheckMs: number;
  private circuitBreakerDurationMs: number;
  private maxRetries: number;
  private timeout: number;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private currentIndex = 0;

  constructor(config: FailoverConfig) {
    super();

    this.healthcheckMs = config.healthcheckMs ?? 15_000;
    this.circuitBreakerDurationMs = config.circuitBreakerDurationMs ?? 60_000;
    this.maxRetries = config.maxRetries ?? 3;
    this.timeout = config.timeout ?? 10_000;

    // Initialize facilitator states
    for (const url of config.facilitators) {
      this.facilitators.set(url, {
        url,
        healthy: true,
        failures: 0,
        lastFailure: 0,
        lastHealthCheck: 0,
        circuitOpenUntil: 0,
      });
    }

    // Start health checks
    this.startHealthChecks();
  }

  /**
   * Get list of healthy facilitator URLs
   */
  getHealthyFacilitators(): string[] {
    const now = Date.now();
    return Array.from(this.facilitators.values())
      .filter((f) => f.healthy && now >= f.circuitOpenUntil)
      .map((f) => f.url);
  }

  /**
   * Get the next healthy facilitator using round-robin
   */
  private getNextFacilitator(): FacilitatorState | null {
    const healthy = this.getHealthyFacilitators();
    if (healthy.length === 0) return null;

    const url = healthy[this.currentIndex % healthy.length];
    this.currentIndex++;
    return this.facilitators.get(url) ?? null;
  }

  /**
   * Settle a payment with failover
   */
  async settle(payload: PaymentPayload): Promise<SettleResult> {
    const errors: string[] = [];
    const maxAttempts = Math.min(this.maxRetries, this.facilitators.size);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const facilitator = this.getNextFacilitator();

      if (!facilitator) {
        return {
          success: false,
          error: `all_facilitators_unavailable: ${errors.join("; ")}`,
        };
      }

      try {
        const result = await this.settleWithFacilitator(facilitator.url, payload);

        if (result.success) {
          // Reset failures on success
          this.markSuccess(facilitator.url);
          return result;
        }

        // Non-network failure, return immediately
        this.markFailure(facilitator.url, result.error ?? "settle_failed");
        errors.push(`${facilitator.url}: ${result.error}`);

        // If this was a validation error (not infra), don't retry
        if (result.error?.includes("verification_failed")) {
          return result;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "network_error";
        this.markFailure(facilitator.url, message);
        errors.push(`${facilitator.url}: ${message}`);

        this.emit("failover", {
          from: facilitator.url,
          to: this.getNextFacilitator()?.url ?? "none",
          error: message,
        });
      }
    }

    return {
      success: false,
      error: `all_retries_exhausted: ${errors.join("; ")}`,
    };
  }

  /**
   * Verify a payment with failover
   */
  async verify(payload: PaymentPayload): Promise<VerifyResult> {
    const maxAttempts = Math.min(this.maxRetries, this.facilitators.size);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const facilitator = this.getNextFacilitator();

      if (!facilitator) {
        return { valid: false, reason: "all_facilitators_unavailable" };
      }

      try {
        const result = await this.verifyWithFacilitator(facilitator.url, payload);
        this.markSuccess(facilitator.url);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "network_error";
        this.markFailure(facilitator.url, message);

        this.emit("failover", {
          from: facilitator.url,
          to: this.getNextFacilitator()?.url ?? "none",
          error: message,
        });
      }
    }

    return { valid: false, reason: "all_retries_exhausted" };
  }

  /**
   * Settle with a specific facilitator
   */
  private async settleWithFacilitator(
    facilitatorUrl: string,
    payload: PaymentPayload,
  ): Promise<SettleResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${facilitatorUrl}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentPayload: payload }),
        signal: controller.signal,
      });

      const data = (await response.json()) as SettleResult;
      return data;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Verify with a specific facilitator
   */
  private async verifyWithFacilitator(
    facilitatorUrl: string,
    payload: PaymentPayload,
  ): Promise<VerifyResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${facilitatorUrl}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentPayload: payload }),
        signal: controller.signal,
      });

      const data = (await response.json()) as VerifyResult;
      return data;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Mark a facilitator as failed, potentially opening circuit breaker
   */
  private markFailure(url: string, error: string): void {
    const state = this.facilitators.get(url);
    if (!state) return;

    state.failures++;
    state.lastFailure = Date.now();

    // Open circuit breaker after 3 failures
    if (state.failures >= 3) {
      state.healthy = false;
      state.circuitOpenUntil = Date.now() + this.circuitBreakerDurationMs;

      this.emit("failover", {
        from: url,
        to: this.getNextFacilitator()?.url ?? "none",
        error,
      });
    }
  }

  /**
   * Mark a facilitator as successful, resetting failure count
   */
  private markSuccess(url: string): void {
    const state = this.facilitators.get(url);
    if (!state) return;

    const wasUnhealthy = !state.healthy;

    state.failures = 0;
    state.healthy = true;
    state.circuitOpenUntil = 0;

    if (wasUnhealthy) {
      this.emit("recovery", { facilitator: url });
    }
  }

  /**
   * Health check all facilitators
   */
  private async checkHealth(url: string): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${url}/health`, {
        signal: controller.signal,
      });

      const ok = response.ok;
      const state = this.facilitators.get(url);

      if (state) {
        state.lastHealthCheck = Date.now();

        if (ok && !state.healthy && Date.now() >= state.circuitOpenUntil) {
          state.healthy = true;
          state.failures = 0;
          state.circuitOpenUntil = 0;
          this.emit("recovery", { facilitator: url });
        }
      }

      return ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Start periodic health checks
   */
  private startHealthChecks(): void {
    this.healthTimer = setInterval(() => {
      for (const [url] of this.facilitators) {
        this.checkHealth(url).catch(() => {});
      }
    }, this.healthcheckMs);

    if (this.healthTimer.unref) {
      this.healthTimer.unref();
    }
  }

  /**
   * Stop health checks and clean up
   */
  destroy(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    this.removeAllListeners();
  }
}
