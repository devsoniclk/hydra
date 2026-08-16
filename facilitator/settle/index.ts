/**
 * Settle module - routes settlements to the appropriate chain settler
 */

import type { PaymentPayload, SettleResult } from "../types.js";
import { BaseSettler, type BaseSettlerOptions } from "./base.js";
import { SolanaSettler, type SolanaSettlerOptions } from "./solana.js";
import { CasperSettler, isCasperNetwork, type CasperSettlerOptions } from "./casper.js";

export interface SettleModuleOptions {
  /** Base/EVM settler options */
  base?: BaseSettlerOptions;
  /** Solana settler options */
  solana?: SolanaSettlerOptions;
  /** Casper settler options */
  casper?: CasperSettlerOptions;
  /** Default RPC URL */
  rpcUrl?: string;
  /** Settler private key */
  settlerKey?: string;
}

export { BaseSettler } from "./base.js";
export { SolanaSettler } from "./solana.js";
export {
  CasperSettler,
  isCasperNetwork,
  parseMotes,
  csprToMotes,
  motesToCspr,
  CASPER_MAINNET,
  CASPER_TESTNET,
  CASPER_NETWORKS,
  WCSPR_DECIMALS,
  DEFAULT_CASPER_FACILITATOR_URL,
} from "./casper.js";

export class SettleModule {
  private baseSettler: BaseSettler | null = null;
  private solanaSettler: SolanaSettler | null = null;
  private casperSettler: CasperSettler | null = null;

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

    // Initialize Casper settler. Settlement is delegated to a Casper x402
    // facilitator, so no local key is required — the hosted endpoint at
    // https://x402-facilitator.cspr.cloud is used unless overridden via
    // options or CASPER_FACILITATOR_URL.
    this.casperSettler = new CasperSettler(options.casper ?? {});
  }

  /**
   * Settle a payment, routing to the appropriate chain
   */
  async settle(payload: PaymentPayload): Promise<SettleResult> {
    if (isCasperNetwork(payload.network)) {
      if (!this.casperSettler) {
        return { success: false, error: "casper_settler_not_configured" };
      }
      return this.casperSettler.settle(payload);
    }

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
