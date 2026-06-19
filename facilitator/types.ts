/**
 * Shared types for the Hydra x402 facilitator
 */

/** x402 payment payload as defined by the spec */
export interface PaymentPayload {
  x402Version: number;
  scheme: "exact" | "upto";
  network: string;
  payload: {
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
  };
}

/** Result of payment verification */
export interface VerifyResult {
  valid: boolean;
  reason?: string;
}

/** Result of payment settlement */
export interface SettleResult {
  success: boolean;
  txHash?: string;
  blockNumber?: bigint;
  proof?: AcceptanceProof;
  error?: string;
}

/** Structured acceptance proof for X-PAYMENT-RESPONSE */
export interface AcceptanceProof {
  transaction: string;
  network: string;
  payer: string;
  payee: string;
  amount: string;
  timestamp: number;
}

/** X-PAYMENT-RESPONSE header value */
export interface XPaymentResponse {
  x402Version: number;
  scheme: string;
  network: string;
  transaction: string;
  proof: AcceptanceProof;
}

/** Health check response */
export interface HealthResponse {
  status: "ok" | "degraded";
  uptime: number;
  version: string;
  facilitators?: number;
}

/** Failover client configuration */
export interface FailoverConfig {
  facilitators: string[];
  healthcheckMs?: number;
  circuitBreakerDurationMs?: number;
  maxRetries?: number;
  timeout?: number;
}

/** Batch settlement result */
export interface BatchResult {
  index: number;
  success: boolean;
  txHash?: string;
  error?: string;
}

/** Facilitator event types */
export interface FailoverEvents {
  failover: { from: string; to: string; error: string };
  recovery: { facilitator: string };
  error: { facilitator: string; error: string };
}
