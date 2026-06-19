/**
 * Settle module - routes settlements to the appropriate chain settler
 */

import type { PaymentPayload, SettleResult } from "../types.js";
import { BaseSettler, type BaseSettlerOptions } from "./base.js";
import { SolanaSettler, type SolanaSettlerOptions } from "./solana.js";

export interface SettleModuleOptions {
  /** Base/EVM settler options */
  base?: BaseSettlerOptions;
  /** Solana settler options */
  solana?: SolanaSettlerOptions;
  /** Default RPC URL */
  rpcUrl?: string;
  /** Settler private key */
  settlerKey?: string;
}

export { BaseSettler } from "./base.js";
export { SolanaSettler } from "./solana.js";

export class SettleModule {
  private baseSettler: BaseSettler | null = null;
  private solanaSettler: SolanaSettler | null = null;

  constructor(options: SettleModuleOptions = {}) {
    const rpcUrl = options.rpcUrl ?? process.env.RPC_URL ?? "https://mainnet.base.org";
    const settlerKey = options.settlerKey ?? process.env.SETTLER_KEY;

    // Initialize Base settler if key is available
    if (options.base || settlerKey) {
      this.baseSettler = new BaseSettler({
        rpcUrl: options.base?.rpcUrl ?? rpcUrl,
        privateKey: options.base?.privateKey ?? settlerKey!,
      });
    }

    // Initialize Solana settler if configured
    if (options.solana) {
      this.solanaSettler = new SolanaSettler({
        rpcUrl: options.solana.rpcUrl,
        privateKey: options.solana.privateKey,
      });
    }
  }

  /**
   * Settle a payment, routing to the appropriate chain
   */
  async settle(payload: PaymentPayload): Promise<SettleResult> {
    switch (payload.network) {
      case "base":
        if (!this.baseSettler) {
          return { success: false, error: "base_settler_not_configured" };
        }
        return this.baseSettler.settle(payload);

      case "solana":
        if (!this.solanaSettler) {
          return { success: false, error: "solana_settler_not_configured" };
        }
        return this.solanaSettler.settle(payload);

      default:
        return { success: false, error: `unsupported_network: ${payload.network}` };
    }
  }
}
