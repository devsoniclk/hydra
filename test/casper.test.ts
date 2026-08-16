import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CasperSettler,
  isCasperNetwork,
  toCaip2Network,
  parseMotes,
  csprToMotes,
  motesToCspr,
  CASPER_MAINNET,
  CASPER_TESTNET,
  WCSPR_DECIMALS,
  DEFAULT_CASPER_FACILITATOR_URL,
} from "../facilitator/settle/casper.js";
import { SettleModule } from "../facilitator/settle/index.js";
import { VerifyModule } from "../facilitator/verify.js";
import { ReplayGuard } from "../facilitator/replay-guard.js";
import type { PaymentPayload } from "../facilitator/types.js";

import validCasperPayment from "./fixtures/valid-casper-payment.json";

const basePayment = validCasperPayment as unknown as PaymentPayload;

/** Deep clone so per-test mutations never leak between tests */
function payment(overrides: Partial<PaymentPayload> = {}): PaymentPayload {
  const clone = JSON.parse(JSON.stringify(basePayment)) as PaymentPayload;
  return { ...clone, ...overrides };
}

/** Build a fetch stub that records calls and returns a canned JSON response */
function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const calls: Array<{ url: string; body: any }> = [];
  const impl = vi.fn(async (url: any, options: any) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
    } as unknown as Response;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("Casper network identifiers", () => {
  it("recognises the CAIP-2 mainnet and testnet ids", () => {
    expect(isCasperNetwork(CASPER_MAINNET)).toBe(true);
    expect(isCasperNetwork(CASPER_TESTNET)).toBe(true);
    expect(CASPER_MAINNET).toBe("casper:casper");
    expect(CASPER_TESTNET).toBe("casper:casper-test");
  });

  it("recognises the short aliases", () => {
    expect(isCasperNetwork("casper")).toBe(true);
    expect(isCasperNetwork("casper-testnet")).toBe(true);
  });

  it("does not claim other networks", () => {
    expect(isCasperNetwork("base")).toBe(false);
    expect(isCasperNetwork("solana")).toBe(false);
    expect(isCasperNetwork("")).toBe(false);
  });

  it("normalises aliases to canonical CAIP-2 ids", () => {
    expect(toCaip2Network("casper")).toBe(CASPER_MAINNET);
    expect(toCaip2Network("casper-testnet")).toBe(CASPER_TESTNET);
    expect(toCaip2Network(CASPER_MAINNET)).toBe(CASPER_MAINNET);
  });
});

describe("wCSPR mote arithmetic", () => {
  it("uses 9 decimals", () => {
    expect(WCSPR_DECIMALS).toBe(9);
  });

  it("parses integer mote strings exactly, without float loss", () => {
    // Larger than Number.MAX_SAFE_INTEGER — must survive as bigint
    expect(parseMotes("9007199254740993")).toBe(9007199254740993n);
    expect(parseMotes("1")).toBe(1n);
    expect(parseMotes(" 2500000000 ")).toBe(2500000000n);
  });

  it("throws on sub-mote precision rather than truncating", () => {
    expect(() => parseMotes("1.5")).toThrow(/sub-mote precision/);
    expect(() => parseMotes("0.000000000001")).toThrow(/sub-mote precision/);
  });

  it("rejects non-numeric, negative, and zero amounts", () => {
    expect(() => parseMotes("abc")).toThrow(/invalid_casper_amount/);
    expect(() => parseMotes("-5")).toThrow(/invalid_casper_amount/);
    expect(() => parseMotes("0")).toThrow(/must be positive/);
    expect(() => parseMotes("")).toThrow(/invalid_casper_amount/);
  });

  it("converts CSPR to motes exactly", () => {
    expect(csprToMotes("1")).toBe(1_000_000_000n);
    expect(csprToMotes("2.5")).toBe(2_500_000_000n);
    expect(csprToMotes("0.000000001")).toBe(1n);
    expect(csprToMotes("123456789.123456789")).toBe(123456789123456789n);
  });

  it("throws when a CSPR amount has more than 9 decimals", () => {
    expect(() => csprToMotes("1.0000000001")).toThrow(/sub-mote precision/);
    expect(() => csprToMotes("0.1234567891")).toThrow(/wCSPR supports 9/);
  });

  it("round-trips motes -> CSPR -> motes losslessly", () => {
    for (const motes of [1n, 999_999_999n, 2_500_000_000n, 123456789123456789n]) {
      expect(csprToMotes(motesToCspr(motes))).toBe(motes);
    }
  });

  it("formats motes as CSPR without trailing zeros", () => {
    expect(motesToCspr(1_000_000_000n)).toBe("1");
    expect(motesToCspr(2_500_000_000n)).toBe("2.5");
    expect(motesToCspr(1n)).toBe("0.000000001");
    expect(motesToCspr(0n)).toBe("0");
  });
});

describe("CasperSettler", () => {
  const originalUrl = process.env.CASPER_FACILITATOR_URL;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.CASPER_FACILITATOR_URL;
    else process.env.CASPER_FACILITATOR_URL = originalUrl;
  });

  it("defaults to the hosted Casper facilitator", () => {
    delete process.env.CASPER_FACILITATOR_URL;
    const settler = new CasperSettler();
    expect(settler.endpoint).toBe(DEFAULT_CASPER_FACILITATOR_URL);
    expect(settler.endpoint).toBe("https://x402-facilitator.cspr.cloud");
    expect(settler.networkId).toBe(CASPER_MAINNET);
  });

  it("honours CASPER_FACILITATOR_URL and strips trailing slashes", () => {
    process.env.CASPER_FACILITATOR_URL = "https://facilitator.internal:8402/";
    const settler = new CasperSettler();
    expect(settler.endpoint).toBe("https://facilitator.internal:8402");
  });

  it("prefers explicit options over the environment", () => {
    process.env.CASPER_FACILITATOR_URL = "https://from-env.example";
    const settler = new CasperSettler({
      facilitatorUrl: "https://from-options.example",
      network: "casper-testnet",
    });
    expect(settler.endpoint).toBe("https://from-options.example");
    expect(settler.networkId).toBe(CASPER_TESTNET);
  });

  it("settles a valid payment and returns a proof", async () => {
    const { impl, calls } = stubFetch({
      success: true,
      transaction: "0dead0beef0cafe0",
      blockHeight: 3210987,
      payer: basePayment.payload.authorization.from,
    });

    const settler = new CasperSettler({
      facilitatorUrl: "https://casper.test",
      fetchImpl: impl,
    });

    const result = await settler.settle(payment());

    expect(result.success).toBe(true);
    expect(result.txHash).toBe("0dead0beef0cafe0");
    expect(result.blockNumber).toBe(3210987n);
    expect(result.proof).toEqual({
      transaction: "0dead0beef0cafe0",
      network: CASPER_MAINNET,
      payer: basePayment.payload.authorization.from,
      payee: basePayment.payload.authorization.to,
      amount: "2500000000",
      timestamp: expect.any(Number),
    });

    // The facilitator is contacted at /settle with an x402 v2 envelope
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://casper.test/settle");
    expect(calls[0].body.paymentPayload.network).toBe(CASPER_MAINNET);
    expect(calls[0].body.paymentRequirements).toMatchObject({
      scheme: "exact",
      network: CASPER_MAINNET,
      maxAmountRequired: "2500000000",
      payTo: basePayment.payload.authorization.to,
    });
  });

  it("normalises the alias network to CAIP-2 in the outbound request", async () => {
    const { impl, calls } = stubFetch({ success: true, transaction: "0xabc" });
    const settler = new CasperSettler({ facilitatorUrl: "https://c.test", fetchImpl: impl });

    const result = await settler.settle(payment({ network: "casper-testnet" }));

    expect(result.success).toBe(true);
    expect(result.proof!.network).toBe(CASPER_TESTNET);
    expect(calls[0].body.paymentRequirements.network).toBe(CASPER_TESTNET);
  });

  it("rejects non-Casper networks without calling the facilitator", async () => {
    const { impl } = stubFetch({ success: true });
    const settler = new CasperSettler({ fetchImpl: impl });

    const result = await settler.settle(payment({ network: "base" }));

    expect(result.success).toBe(false);
    expect(result.error).toBe("unsupported_network: base");
    expect(impl).not.toHaveBeenCalled();
  });

  it("rejects unsupported schemes", async () => {
    const { impl } = stubFetch({ success: true });
    const settler = new CasperSettler({ fetchImpl: impl });

    const result = await settler.settle(payment({ scheme: "upto" }));

    expect(result.success).toBe(false);
    expect(result.error).toBe("unsupported_casper_scheme: upto");
    expect(impl).not.toHaveBeenCalled();
  });

  it("rejects a malformed Casper signature", async () => {
    const { impl } = stubFetch({ success: true });
    const settler = new CasperSettler({ fetchImpl: impl });

    const bad = payment();
    bad.payload.signature = "0xdeadbeef";

    const result = await settler.settle(bad);

    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid_casper_signature");
    expect(impl).not.toHaveBeenCalled();
  });

  it("fails loudly on sub-mote amounts instead of rounding", async () => {
    const { impl } = stubFetch({ success: true });
    const settler = new CasperSettler({ fetchImpl: impl });

    const fractional = payment();
    fractional.payload.authorization.value = "1.5";

    const result = await settler.settle(fractional);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/casper_settlement_error/);
    expect(result.error).toMatch(/sub-mote precision/);
    expect(impl).not.toHaveBeenCalled();
  });

  it("surfaces a facilitator error reason", async () => {
    const { impl } = stubFetch({ success: false, errorReason: "insufficient_funds" });
    const settler = new CasperSettler({ fetchImpl: impl });

    const result = await settler.settle(payment());

    expect(result.success).toBe(false);
    expect(result.error).toBe("casper_settlement_failed: insufficient_funds");
  });

  it("surfaces an HTTP error from the facilitator", async () => {
    const { impl } = stubFetch({}, { ok: false, status: 503 });
    const settler = new CasperSettler({ fetchImpl: impl });

    const result = await settler.settle(payment());

    expect(result.success).toBe(false);
    expect(result.error).toBe("casper_settlement_failed: http_503");
  });

  it("fails when the facilitator returns no deploy hash", async () => {
    const { impl } = stubFetch({ success: true });
    const settler = new CasperSettler({ fetchImpl: impl });

    const result = await settler.settle(payment());

    expect(result.success).toBe(false);
    expect(result.error).toBe("casper_settlement_failed: missing_deploy_hash");
  });

  it("does not throw when the network call fails", async () => {
    const impl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const settler = new CasperSettler({ fetchImpl: impl });
    const result = await settler.settle(payment());

    expect(result.success).toBe(false);
    expect(result.error).toBe("casper_settlement_error: ECONNREFUSED");
  });
});

describe("SettleModule routing", () => {
  it("routes Casper payloads to the Casper settler", async () => {
    const { impl, calls } = stubFetch({ success: true, transaction: "0xcasper" });
    const settleModule = new SettleModule({
      casper: { facilitatorUrl: "https://routed.test", fetchImpl: impl },
    });

    const result = await settleModule.settle(payment());

    expect(result.success).toBe(true);
    expect(result.txHash).toBe("0xcasper");
    expect(calls[0].url).toBe("https://routed.test/settle");
  });

  it("routes the casper-testnet alias too", async () => {
    const { impl } = stubFetch({ success: true, transaction: "0xtestnet" });
    const settleModule = new SettleModule({
      casper: { facilitatorUrl: "https://routed.test", fetchImpl: impl },
    });

    const result = await settleModule.settle(payment({ network: "casper-testnet" }));
    expect(result.txHash).toBe("0xtestnet");
  });

  it("still rejects genuinely unsupported networks", async () => {
    const settleModule = new SettleModule();
    const result = await settleModule.settle(payment({ network: "dogecoin" }));

    expect(result.success).toBe(false);
    expect(result.error).toBe("unsupported_network: dogecoin");
  });

  it("leaves Solana routing untouched", async () => {
    const settleModule = new SettleModule();
    const result = await settleModule.settle(payment({ network: "solana" }));

    expect(result.success).toBe(false);
    expect(result.error).toBe("solana_settler_not_configured");
  });
});

describe("VerifyModule Casper support", () => {
  let guard: ReplayGuard;
  let verifier: VerifyModule;

  beforeEach(() => {
    guard = new ReplayGuard({ defaultTtlSeconds: 60 });
    verifier = new VerifyModule({ replayGuard: guard });
  });

  afterEach(() => {
    guard.destroy();
  });

  it("accepts a well-formed Casper payment", async () => {
    const result = await verifier.verifyPayment(payment());
    expect(result).toEqual({ valid: true });
  });

  it("accepts the testnet CAIP-2 id", async () => {
    const result = await verifier.verifyPayment(payment({ network: CASPER_TESTNET }));
    expect(result.valid).toBe(true);
  });

  it("marks the nonce used and blocks replay", async () => {
    const first = await verifier.verifyPayment(payment());
    expect(first.valid).toBe(true);

    const replay = await verifier.verifyPayment(payment());
    expect(replay.valid).toBe(false);
    expect(replay.reason).toBe("nonce_already_used");
  });

  it("rejects an expired Casper authorization", async () => {
    const expired = payment();
    expired.payload.authorization.validBefore = "1700000000";

    const result = await verifier.verifyPayment(expired);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("authorization_expired");
  });

  it("rejects a short Casper signature", async () => {
    const bad = payment();
    bad.payload.signature = "0x1234";

    const result = await verifier.verifyPayment(bad);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid_casper_signature");
  });

  it("rejects a sub-mote Casper amount", async () => {
    const fractional = payment();
    fractional.payload.authorization.value = "0.0000000005";

    const result = await verifier.verifyPayment(fractional);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/casper_verification_error/);
    expect(result.reason).toMatch(/sub-mote precision/);
  });

  it("rejects a non-exact scheme on Casper", async () => {
    const result = await verifier.verifyPayment(payment({ scheme: "upto" }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("unsupported_casper_scheme");
  });

  it("still rejects unknown networks", async () => {
    const result = await verifier.verifyPayment(payment({ network: "casperr" }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("unsupported_network");
  });
});

describe("Casper fixture", () => {
  it("mirrors the shape of the existing payment fixtures", () => {
    expect(basePayment.x402Version).toBe(1);
    expect(basePayment.scheme).toBe("exact");
    expect(basePayment.network).toBe(CASPER_MAINNET);
    expect(basePayment.payload.signature).toBeTruthy();
    expect(basePayment.payload.authorization.from).toBeTruthy();
    expect(basePayment.payload.authorization.to).toBeTruthy();
    expect(parseMotes(basePayment.payload.authorization.value)).toBe(2_500_000_000n);
  });
});
