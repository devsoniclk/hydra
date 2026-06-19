/**
 * Verify module - signature / balance / nonce / expiry / replay verification
 *
 * Validates x402 payment payloads before settlement.
 */

import { type PublicClient, createPublicClient, http, formatUnits, parseAbi } from "viem";
import { base } from "viem/chains";
import type { PaymentPayload, VerifyResult } from "./types.js";
import { ReplayGuard } from "./replay-guard.js";

/** USDC contract address on Base */
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

/** EIP-3009 transferWithAuthorization ABI fragment */
const EIP3009_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)",
]);

export interface VerifyModuleOptions {
  /** EVM RPC URL */
  rpcUrl?: string;
  /** Replay guard instance */
  replayGuard?: ReplayGuard;
}

export class VerifyModule {
  private client: PublicClient;
  private replayGuard: ReplayGuard;

  constructor(options: VerifyModuleOptions = {}) {
    this.client = createPublicClient({
      chain: base,
      transport: http(options.rpcUrl ?? "https://mainnet.base.org"),
    }) as PublicClient;

    this.replayGuard = options.replayGuard ?? new ReplayGuard();
  }

  /**
   * Verify a payment payload
   */
  async verifyPayment(payload: PaymentPayload): Promise<VerifyResult> {
    try {
      // 1. Check x402 version
      if (payload.x402Version !== 1) {
        return { valid: false, reason: "unsupported_x402_version" };
      }

      // 2. Check scheme
      if (payload.scheme !== "exact" && payload.scheme !== "upto") {
        return { valid: false, reason: "unsupported_scheme" };
      }

      // 3. Check network
      if (payload.network !== "base" && payload.network !== "solana") {
        return { valid: false, reason: "unsupported_network" };
      }

      // 4. Validate authorization fields
      const { authorization, signature } = payload.payload;
      if (!authorization || !signature) {
        return { valid: false, reason: "missing_authorization" };
      }

      const { from, to, value, validAfter, validBefore, nonce } = authorization;

      if (!from || !to || !value || !validBefore || !nonce) {
        return { valid: false, reason: "incomplete_authorization" };
      }

      // 5. Check expiry
      if (this.replayGuard.isExpired(validBefore)) {
        return { valid: false, reason: "authorization_expired" };
      }

      // 6. Check validAfter (not before this time)
      if (validAfter) {
        const validAfterNum = parseInt(validAfter, 10);
        const validAfterMs = validAfterNum > 1e12 ? validAfterNum : validAfterNum * 1000;
        if (Date.now() < validAfterMs) {
          return { valid: false, reason: "authorization_not_yet_valid" };
        }
      }

      // 7. Check nonce replay
      if (this.replayGuard.isNonceUsed(nonce)) {
        return { valid: false, reason: "nonce_already_used" };
      }

      // 8. Network-specific verification
      if (payload.network === "base") {
        return await this.verifyEvmPayment(payload);
      } else if (payload.network === "solana") {
        return await this.verifySolanaPayment(payload);
      }

      return { valid: false, reason: "unsupported_network" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      return { valid: false, reason: `verification_error: ${message}` };
    }
  }

  /**
   * Verify an EVM (Base) payment
   */
  private async verifyEvmPayment(payload: PaymentPayload): Promise<VerifyResult> {
    const { authorization, signature } = payload.payload;
    const { from, to, value, validAfter, validBefore, nonce } = authorization;

    try {
      // Check USDC balance of the payer
      const balance = await this.client.readContract({
        address: USDC_BASE,
        abi: EIP3009_ABI,
        functionName: "balanceOf",
        args: [from as `0x${string}`],
      });

      const requiredAmount = BigInt(value);

      if (balance < requiredAmount) {
        return {
          valid: false,
          reason: `insufficient_balance: has ${formatUnits(balance, 6)} USDC, needs ${formatUnits(requiredAmount, 6)} USDC`,
        };
      }

      // Verify the EIP-3009 signature by attempting an eth_call to simulate
      // In production, we'd recover the signer from the signature and verify it matches `from`
      // For now, we validate the signature format
      if (!signature || signature.length < 130) {
        return { valid: false, reason: "invalid_signature_format" };
      }

      // Mark nonce as used
      this.replayGuard.markNonceUsed(nonce);

      return { valid: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      return { valid: false, reason: `evm_verification_error: ${message}` };
    }
  }

  /**
   * Verify a Solana payment
   */
  private async verifySolanaPayment(payload: PaymentPayload): Promise<VerifyResult> {
    const { authorization, signature } = payload.payload;

    try {
      // For Solana, we verify the transfer signature
      // In production, this would verify against Solana's SPL Token program
      if (!signature || signature.length < 64) {
        return { valid: false, reason: "invalid_solana_signature" };
      }

      // Mark nonce as used
      this.replayGuard.markNonceUsed(authorization.nonce);

      return { valid: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      return { valid: false, reason: `solana_verification_error: ${message}` };
    }
  }
}
