/**
 * Batch settler - accumulates payments and settles in batches for fee efficiency
 */

import type { PaymentPayload, SettleResult, BatchResult } from "./types.js";
import { SettleModule } from "./settle/index.js";

export interface BatchSettlerOptions {
  /** Maximum batch size before auto-flush (default: 10) */
  batchSize?: number;
  /** Auto-flush interval in ms (default: 30000) */
  flushIntervalMs?: number;
  /** Settle module instance */
  settleModule: SettleModule;
}

interface PendingPayment {
  payload: PaymentPayload;
  index: number;
}

export class BatchSettler {
  private pending: PendingPayment[] = [];
  private batchSize: number;
  private flushIntervalMs: number;
  private settleModule: SettleModule;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private nextIndex = 0;

  constructor(options: BatchSettlerOptions) {
    this.batchSize = options.batchSize ?? 10;
    this.flushIntervalMs = options.flushIntervalMs ?? 30_000;
    this.settleModule = options.settleModule;

    // Auto-flush on interval
    this.flushTimer = setInterval(() => {
      if (this.pending.length > 0) {
        this.flush().catch(console.error);
      }
    }, this.flushIntervalMs);

    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }

  /**
   * Add a payment to the batch
   * Auto-flushes if batch size is reached
   */
  async addPayment(payload: PaymentPayload): Promise<number> {
    const index = this.nextIndex++;
    this.pending.push({ payload, index });

    if (this.pending.length >= this.batchSize) {
      await this.flush();
    }

    return index;
  }

  /**
   * Flush all pending payments, settling them
   */
  async flush(): Promise<BatchResult[]> {
    const toSettle = [...this.pending];
    this.pending = [];

    if (toSettle.length === 0) {
      return [];
    }

    const results: BatchResult[] = [];

    // Settle all payments concurrently
    const settlePromises = toSettle.map(async (item) => {
      try {
        const result = await this.settleModule.settle(item.payload);
        return {
          index: item.index,
          success: result.success,
          txHash: result.txHash,
          error: result.error,
        } as BatchResult;
      } catch (error) {
        return {
          index: item.index,
          success: false,
          error: error instanceof Error ? error.message : "batch_settle_error",
        } as BatchResult;
      }
    });

    const settled = await Promise.allSettled(settlePromises);

    for (const result of settled) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      }
    }

    return results;
  }

  /**
   * Get the number of pending payments
   */
  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Destroy the batch settler, clearing timers
   */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.pending = [];
  }
}
