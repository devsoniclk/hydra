/**
 * Casper settlement for x402 payments
 *
 * Handles wCSPR (CEP-18) transfers on the Casper Network.
 *
 * Unlike Base (where the facilitator submits an EIP-3009 transaction itself)
 * or Solana (where it forwards a pre-signed transaction), Casper settlement is
 * delegated to a Casper x402 facilitator, which owns the deploy construction
 * and CEP-18 `transfer_from` execution. That keeps Hydra dependency-free for
 * Casper: settlement is a plain HTTP call, no Casper SDK required.
 *
 * The default endpoint is the public hosted facilitator at
 * https://x402-facilitator.cspr.cloud, overridable via `CASPER_FACILITATOR_URL`.
 */

import type { PaymentPayload, SettleResult, AcceptanceProof } from "../types.js";

/** Default hosted Casper x402 facilitator (public, no auth required) */
export const DEFAULT_CASPER_FACILITATOR_URL = "https://x402-facilitator.cspr.cloud";

/** CAIP-2 network id for Casper mainnet */
export const CASPER_MAINNET = "casper:casper";

/** CAIP-2 network id for Casper testnet */
export const CASPER_TESTNET = "casper:casper-test";

/**
 * Network identifiers accepted for Casper settlement.
 *
 * The CAIP-2 ids are canonical; the bare aliases exist because the rest of
 * Hydra models networks as short names ("base", "solana").
 */
export const CASPER_NETWORKS = [
  CASPER_MAINNET,
  CASPER_TESTNET,
  "casper",
  "casper-testnet",
] as const;

/** wCSPR is a CEP-18 token with 9 decimals — the base unit is the mote */
export const WCSPR_DECIMALS = 9;

/** 1 CSPR = 10^9 motes */
export const MOTES_PER_CSPR = 10n ** BigInt(WCSPR_DECIMALS);

/** Returns true if `network` refers to the Casper Network */
export function isCasperNetwork(network: string): boolean {
  return (CASPER_NETWORKS as readonly string[]).includes(network);
}

/** Resolve any accepted Casper alias to its canonical CAIP-2 id */
export function toCaip2Network(network: string): string {
  if (network === "casper") return CASPER_MAINNET;
  if (network === "casper-testnet") return CASPER_TESTNET;
  return network;
}

/**
 * Parse an amount string denominated in motes.
 *
 * Amounts crossing the facilitator boundary are always integer mote strings.
 * Anything fractional, signed, or non-numeric is rejected rather than
 * truncated — silently rounding a payment amount is never acceptable.
 */
export function parseMotes(value: string): bigint {
  if (typeof value !== "string" || value.trim() === "") {
    return throwInvalid("empty_amount");
  }

  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) {
    if (/^\d*\.\d+$/.test(trimmed)) {
      return throwInvalid(
        `sub-mote precision is not representable: "${trimmed}" (wCSPR has ${WCSPR_DECIMALS} decimals; amounts must be whole motes)`,
      );
    }
    return throwInvalid(`not an integer mote amount: "${trimmed}"`);
  }

  const motes = BigInt(trimmed);
  if (motes <= 0n) {
    return throwInvalid(`amount must be positive: "${trimmed}"`);
  }

  return motes;
}

/**
 * Convert a decimal CSPR amount to motes exactly.
 *
 * Throws when the input carries more than {@link WCSPR_DECIMALS} decimal
 * places, since that value cannot be represented on-chain. No rounding,
 * no truncation.
 */
export function csprToMotes(amount: string): bigint {
  if (typeof amount !== "string" || amount.trim() === "") {
    return throwInvalid("empty_amount");
  }

  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return throwInvalid(`not a decimal CSPR amount: "${trimmed}"`);
  }

  const [whole, fraction = ""] = trimmed.split(".");

  if (fraction.length > WCSPR_DECIMALS) {
    return throwInvalid(
      `sub-mote precision is not representable: "${trimmed}" has ${fraction.length} decimals, wCSPR supports ${WCSPR_DECIMALS}`,
    );
  }

  const padded = fraction.padEnd(WCSPR_DECIMALS, "0");
  return BigInt(whole) * MOTES_PER_CSPR + BigInt(padded === "" ? "0" : padded);
}

/** Format a mote amount as a decimal CSPR string (lossless) */
export function motesToCspr(motes: bigint): string {
  const negative = motes < 0n;
  const abs = negative ? -motes : motes;
  const whole = abs / MOTES_PER_CSPR;
  const fraction = (abs % MOTES_PER_CSPR).toString().padStart(WCSPR_DECIMALS, "0");
  const trimmed = fraction.replace(/0+$/, "");
  const body = trimmed === "" ? `${whole}` : `${whole}.${trimmed}`;
  return negative ? `-${body}` : body;
}

function throwInvalid(reason: string): never {
  throw new Error(`invalid_casper_amount: ${reason}`);
}

/** Response shape returned by the Casper x402 facilitator `/settle` endpoint */
interface CasperFacilitatorSettleResponse {
  success?: boolean;
  transaction?: string;
  txHash?: string;
  deployHash?: string;
  blockHeight?: number | string;
  network?: string;
  payer?: string;
  errorReason?: string;
  error?: string;
}

export interface CasperSettlerOptions {
  /** Casper x402 facilitator base URL */
  facilitatorUrl?: string;
  /** CAIP-2 network id, e.g. "casper:casper" or "casper:casper-test" */
  network?: string;
  /** wCSPR (CEP-18) contract hash used for settlement, if pinned */
  assetContractHash?: string;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Injectable fetch implementation (tests, proxies, custom agents) */
  fetchImpl?: typeof fetch;
}

export class CasperSettler {
  private facilitatorUrl: string;
  private network: string;
  private assetContractHash?: string;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(options: CasperSettlerOptions = {}) {
    this.facilitatorUrl = (
      options.facilitatorUrl ??
      process.env.CASPER_FACILITATOR_URL ??
      DEFAULT_CASPER_FACILITATOR_URL
    ).replace(/\/+$/, "");
    this.network = toCaip2Network(
      options.network ?? process.env.CASPER_NETWORK ?? CASPER_MAINNET,
    );
    this.assetContractHash = options.assetContractHash ?? process.env.CASPER_WCSPR_CONTRACT;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Base URL of the Casper facilitator this settler talks to */
  get endpoint(): string {
    return this.facilitatorUrl;
  }

  /** Canonical CAIP-2 network id this settler is configured for */
  get networkId(): string {
    return this.network;
  }

  /**
   * Settle a payment on Casper.
   *
   * 1. Validate the payload is a Casper `exact` payment with a signature
   * 2. Validate the amount is exact integer motes
   * 3. Forward the x402 envelope to the Casper facilitator `/settle`
   * 4. Map the facilitator response onto Hydra's SettleResult + AcceptanceProof
   */
  async settle(payload: PaymentPayload): Promise<SettleResult> {
    try {
      if (!isCasperNetwork(payload.network)) {
        return { success: false, error: `unsupported_network: ${payload.network}` };
      }

      if (payload.scheme !== "exact") {
        return { success: false, error: `unsupported_casper_scheme: ${payload.scheme}` };
      }

      const { authorization, signature } = payload.payload;

      if (!authorization || !signature) {
        return { success: false, error: "missing_casper_authorization" };
      }

      const { from, to, value, nonce } = authorization;

      // Casper signatures are 64-byte ed25519/secp256k1 signatures with a
      // 1-byte algorithm tag, hex-encoded (130 chars).
      if (signature.length < 128) {
        return { success: false, error: "invalid_casper_signature" };
      }

      // Exact mote arithmetic. Sub-mote precision throws rather than rounding.
      const motes = parseMotes(value);

      const response = await this.post("/settle", {
        x402Version: payload.x402Version,
        paymentPayload: payload,
        paymentRequirements: {
          scheme: "exact",
          network: toCaip2Network(payload.network),
          maxAmountRequired: motes.toString(),
          payTo: to,
          asset: this.assetContractHash,
        },
      });

      const settled = response.success !== false && !response.errorReason && !response.error;

      if (!settled) {
        return {
          success: false,
          error: `casper_settlement_failed: ${response.errorReason ?? response.error ?? "unknown_error"}`,
        };
      }

      const txHash = response.transaction ?? response.txHash ?? response.deployHash;

      if (!txHash) {
        return { success: false, error: "casper_settlement_failed: missing_deploy_hash" };
      }

      const proof: AcceptanceProof = {
        transaction: txHash,
        network: toCaip2Network(payload.network),
        payer: response.payer ?? from,
        payee: to,
        amount: motes.toString(),
        timestamp: Math.floor(Date.now() / 1000),
      };

      return {
        success: true,
        txHash,
        blockNumber: BigInt(response.blockHeight ?? 0),
        proof,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "settlement_failed";
      return {
        success: false,
        error: `casper_settlement_error: ${message}`,
      };
    }
  }

  /** POST a JSON body to the Casper facilitator with a bounded timeout */
  private async post(
    path: string,
    body: unknown,
  ): Promise<CasperFacilitatorSettleResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.facilitatorUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const data = (await response.json()) as CasperFacilitatorSettleResponse;

      if (!response.ok) {
        return {
          success: false,
          errorReason: data?.errorReason ?? data?.error ?? `http_${response.status}`,
        };
      }

      return data;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
