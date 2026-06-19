/**
 * Receipt generator - X-PAYMENT-RESPONSE proof of acceptance
 *
 * Generates structured proofs suitable for the X-PAYMENT-RESPONSE header.
 */

import type { SettleResult, AcceptanceProof, XPaymentResponse } from "./types.js";

export class ReceiptGenerator {
  /**
   * Generate an acceptance proof from a settle result
   */
  generateAcceptanceProof(settleResult: SettleResult): XPaymentResponse | null {
    if (!settleResult.success || !settleResult.proof) {
      return null;
    }

    return {
      x402Version: 1,
      scheme: "exact",
      network: settleResult.proof.network,
      transaction: settleResult.proof.transaction,
      proof: settleResult.proof,
    };
  }

  /**
   * Encode an X-PAYMENT-RESPONSE header value
   */
  encodeHeader(response: XPaymentResponse): string {
    return Buffer.from(JSON.stringify(response)).toString("base64");
  }

  /**
   * Decode an X-PAYMENT-RESPONSE header value
   */
  decodeHeader(headerValue: string): XPaymentResponse {
    const decoded = Buffer.from(headerValue, "base64").toString("utf-8");
    return JSON.parse(decoded) as XPaymentResponse;
  }

  /**
   * Generate and encode in one step
   */
  generateHeader(settleResult: SettleResult): string | null {
    const response = this.generateAcceptanceProof(settleResult);
    if (!response) return null;
    return this.encodeHeader(response);
  }
}
