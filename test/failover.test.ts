import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FailoverClient } from "../client/failover.js";
import type { PaymentPayload } from "../facilitator/types.js";

// Mock payment payload
const mockPayment: PaymentPayload = {
  x402Version: 1,
  scheme: "exact",
  network: "base",
  payload: {
    signature: "0x" + "a".repeat(130),
    authorization: {
      from: "0x1234567890abcdef1234567890abcdef12345678",
      to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      value: "1000000",
      validAfter: String(Math.floor(Date.now() / 1000) - 60),
      validBefore: String(Math.floor(Date.now() / 1000) + 300),
      nonce: "0x" + "00".repeat(31) + "01",
    },
  },
};

describe("FailoverClient", () => {
  let client: FailoverClient;

  afterEach(() => {
    if (client) client.destroy();
  });

  it("should initialize with facilitator URLs", () => {
    client = new FailoverClient({
      facilitators: ["http://localhost:8402", "http://localhost:8403"],
      healthcheckMs: 60_000,
    });

    const healthy = client.getHealthyFacilitators();
    expect(healthy).toHaveLength(2);
    expect(healthy).toContain("http://localhost:8402");
    expect(healthy).toContain("http://localhost:8403");
  });

  it("should start with all facilitators healthy", () => {
    client = new FailoverClient({
      facilitators: ["http://a.com", "http://b.com", "http://c.com"],
      healthcheckMs: 60_000,
    });

    expect(client.getHealthyFacilitators()).toHaveLength(3);
  });

  it("should emit failover event on settle failure", async () => {
    // Use unreachable URLs to trigger failures
    client = new FailoverClient({
      facilitators: ["http://127.0.0.1:1", "http://127.0.0.1:2"],
      healthcheckMs: 60_000,
      circuitBreakerDurationMs: 1000,
      maxRetries: 2,
      timeout: 500,
    });

    const failoverEvents: Array<{ from: string; to: string; error: string }> = [];
    client.on("failover", (event) => failoverEvents.push(event));

    const result = await client.settle(mockPayment);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("should return error when all facilitators are down", async () => {
    client = new FailoverClient({
      facilitators: ["http://127.0.0.1:1"],
      healthcheckMs: 60_000,
      maxRetries: 1,
      timeout: 200,
    });

    const result = await client.settle(mockPayment);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("should verify with failover", async () => {
    client = new FailoverClient({
      facilitators: ["http://127.0.0.1:1"],
      healthcheckMs: 60_000,
      maxRetries: 1,
      timeout: 200,
    });

    const result = await client.verify(mockPayment);
    expect(result.valid).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("should clean up on destroy", () => {
    client = new FailoverClient({
      facilitators: ["http://localhost:8402"],
      healthcheckMs: 60_000,
    });

    // Should not throw
    client.destroy();
  });
});
