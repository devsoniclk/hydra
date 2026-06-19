import { describe, it, expect } from "vitest";
import { ReceiptGenerator } from "../facilitator/receipts.js";
import type { SettleResult, AcceptanceProof, XPaymentResponse } from "../facilitator/types.js";

describe("ReceiptGenerator", () => {
  const generator = new ReceiptGenerator();

  const mockProof: AcceptanceProof = {
    transaction: "0xabc123",
    network: "base",
    payer: "0x1234567890abcdef1234567890abcdef12345678",
    payee: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    amount: "1000000",
    timestamp: 1700000000,
  };

  const mockSettleResult: SettleResult = {
    success: true,
    txHash: "0xabc123",
    blockNumber: 12345n,
    proof: mockProof,
  };

  it("should generate acceptance proof from successful settle result", () => {
    const proof = generator.generateAcceptanceProof(mockSettleResult);

    expect(proof).not.toBeNull();
    expect(proof!.x402Version).toBe(1);
    expect(proof!.scheme).toBe("exact");
    expect(proof!.network).toBe("base");
    expect(proof!.transaction).toBe("0xabc123");
    expect(proof!.proof).toEqual(mockProof);
  });

  it("should return null for failed settle result", () => {
    const failedResult: SettleResult = {
      success: false,
      error: "settlement_failed",
    };

    const proof = generator.generateAcceptanceProof(failedResult);
    expect(proof).toBeNull();
  });

  it("should encode and decode header correctly", () => {
    const response: XPaymentResponse = {
      x402Version: 1,
      scheme: "exact",
      network: "base",
      transaction: "0xabc123",
      proof: mockProof,
    };

    const encoded = generator.encodeHeader(response);
    expect(typeof encoded).toBe("string");

    const decoded = generator.decodeHeader(encoded);
    expect(decoded).toEqual(response);
  });

  it("should generate header from settle result", () => {
    const header = generator.generateHeader(mockSettleResult);

    expect(header).not.toBeNull();
    expect(typeof header).toBe("string");

    // Decode and verify
    const decoded = generator.decodeHeader(header!);
    expect(decoded.x402Version).toBe(1);
    expect(decoded.transaction).toBe("0xabc123");
  });

  it("should return null header for failed result", () => {
    const failedResult: SettleResult = {
      success: false,
      error: "settlement_failed",
    };

    const header = generator.generateHeader(failedResult);
    expect(header).toBeNull();
  });
});

describe("BatchSettler", () => {
  it("should track pending count", async () => {
    // Simple structural test without actual settlement
    const { BatchSettler } = await import("../facilitator/batch.js");
    const { SettleModule } = await import("../facilitator/settle/index.js");

    const settleModule = new SettleModule();
    const batchSettler = new BatchSettler({
      batchSize: 5,
      flushIntervalMs: 60_000,
      settleModule,
    });

    expect(batchSettler.pendingCount).toBe(0);
    batchSettler.destroy();
  });
});
