/**
 * Base/EVM USDC settlement via EIP-3009 transferWithAuthorization
 */

import {
  type WalletClient,
  createWalletClient,
  createPublicClient,
  http,
  type PublicClient,
  type Hash,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import type { PaymentPayload, SettleResult, AcceptanceProof } from "../types.js";

/** USDC contract address on Base */
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

/** EIP-3009 ABI */
const EIP3009_ABI = [
  {
    name: "transferWithAuthorization",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export interface BaseSettlerOptions {
  /** EVM RPC URL */
  rpcUrl?: string;
  /** Private key for the settlement wallet */
  privateKey: string;
  /** Recipient address (where USDC is sent) */
  recipientAddress?: string;
}

export class BaseSettler {
  private walletClient: WalletClient;
  private publicClient: PublicClient;
  private account: ReturnType<typeof privateKeyToAccount>;

  constructor(options: BaseSettlerOptions) {
    this.account = privateKeyToAccount(options.privateKey as `0x${string}`);

    this.walletClient = createWalletClient({
      account: this.account,
      chain: base,
      transport: http(options.rpcUrl ?? "https://mainnet.base.org"),
    });

    this.publicClient = createPublicClient({
      chain: base,
      transport: http(options.rpcUrl ?? "https://mainnet.base.org"),
    }) as PublicClient;
  }

  /**
   * Settle a payment on Base via EIP-3009 transferWithAuthorization
   */
  async settle(payload: PaymentPayload): Promise<SettleResult> {
    try {
      const { authorization, signature } = payload.payload;
      const { from, to, value, validAfter, validBefore, nonce } = authorization;

      // Submit the transferWithAuthorization transaction
      const hash: Hash = await this.walletClient.writeContract({
        address: USDC_BASE,
        abi: EIP3009_ABI,
        functionName: "transferWithAuthorization",
        args: [
          from as `0x${string}`,
          to as `0x${string}`,
          BigInt(value),
          BigInt(validAfter || "0"),
          BigInt(validBefore),
          nonce as `0x${string}`,
          signature as `0x${string}`,
        ],
      });

      // Wait for confirmation
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      const proof: AcceptanceProof = {
        transaction: hash,
        network: "base",
        payer: from,
        payee: to,
        amount: value,
        timestamp: Math.floor(Date.now() / 1000),
      };

      return {
        success: true,
        txHash: hash,
        blockNumber: receipt.blockNumber,
        proof,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "settlement_failed";
      return {
        success: false,
        error: `base_settlement_error: ${message}`,
      };
    }
  }
}
