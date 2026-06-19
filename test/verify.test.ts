import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ReplayGuard } from "../facilitator/replay-guard.js";
import type { PaymentPayload } from "../facilitator/types.js";

import validPayment from "./fixtures/valid-payment.json" assert { type: "json" };
import expiredPayment from "./fixtures/expired-payment.json" assert { type: "json" };

describe("ReplayGuard", () => {
  let guard: ReplayGuard;

  beforeEach(() => {
    guard = new ReplayGuard({ defaultTtlSeconds: 60 });
  });

  afterEach(() => {
    guard.destroy();
  });

  it("should report unused nonce as not used", () => {
    expect(guard.isNonceUsed("0xabc")).toBe(false);
  });

  it("should mark nonce as used and detect it", () => {
    guard.markNonceUsed("0xabc");
    expect(guard.isNonceUsed("0xabc")).toBe(true);
  });

  it("should detect different nonces independently", () => {
    guard.markNonceUsed("0xabc");
    expect(guard.isNonceUsed("0xdef")).toBe(false);
    expect(guard.isNonceUsed("0xabc")).toBe(true);
  });

  it("should respect expiry time", () => {
    // Mark with expiry in the past
    guard.markNonceUsed("0xabc", Date.now() - 1000);
    expect(guard.isNonceUsed("0xabc")).toBe(false);
  });

  it("should detect expired timestamps", () => {
    expect(guard.isExpired("1700000000")).toBe(true); // Nov 2023
    expect(guard.isExpired("9999999999")).toBe(false); // Year 2286
  });

  it("should handle numeric expiry timestamps", () => {
    expect(guard.isExpired(1700000000)).toBe(true);
    expect(guard.isExpired(9999999999)).toBe(false);
  });

  it("should cleanup expired nonces", () => {
    guard.markNonceUsed("0xexpired", Date.now() - 1000);
    guard.markNonceUsed("0xvalid", Date.now() + 60_000);

    expect(guard.size).toBe(2);

    const removed = guard.cleanup();
    expect(removed).toBe(1);
    expect(guard.size).toBe(1);
    expect(guard.isNonceUsed("0xvalid")).toBe(true);
  });

  it("should track size correctly", () => {
    expect(guard.size).toBe(0);
    guard.markNonceUsed("0xa");
    guard.markNonceUsed("0xb");
    expect(guard.size).toBe(2);
  });
});

describe("Verify module (structural tests)", () => {
  it("valid payment fixture has correct structure", () => {
    const payment = validPayment as unknown as PaymentPayload;
    expect(payment.x402Version).toBe(1);
    expect(payment.scheme).toBe("exact");
    expect(payment.network).toBe("base");
    expect(payment.payload.authorization.from).toBeTruthy();
    expect(payment.payload.authorization.to).toBeTruthy();
    expect(payment.payload.authorization.value).toBeTruthy();
    expect(payment.payload.signature).toBeTruthy();
  });

  it("expired payment fixture has validBefore in the past", () => {
    const payment = expiredPayment as unknown as PaymentPayload;
    const validBefore = parseInt(payment.payload.authorization.validBefore, 10);
    expect(validBefore).toBeLessThan(Date.now() / 1000);
  });
});
