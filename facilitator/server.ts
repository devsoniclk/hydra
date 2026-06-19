/**
 * Hydra Facilitator HTTP Server
 *
 * Hono-based HTTP server implementing the x402 verify/settle API.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { VerifyModule } from "./verify.js";
import { SettleModule } from "./settle/index.js";
import { ReceiptGenerator } from "./receipts.js";
import { ReplayGuard } from "./replay-guard.js";
import type { PaymentPayload } from "./types.js";

const PORT = parseInt(process.env.PORT ?? "8402", 10);
const RPC_URL = process.env.RPC_URL ?? "https://mainnet.base.org";
const SETTLER_KEY = process.env.SETTLER_KEY ?? "";
const REDIS_URL = process.env.REDIS_URL ?? "";
const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

const startTime = Date.now();

// Initialize components
const replayGuard = new ReplayGuard({
  redisUrl: REDIS_URL || undefined,
  defaultTtlSeconds: 3600,
});

const verifyModule = new VerifyModule({
  rpcUrl: RPC_URL,
  replayGuard,
});

const settleModule = new SettleModule({
  rpcUrl: RPC_URL,
  settlerKey: SETTLER_KEY || undefined,
});

const receiptGenerator = new ReceiptGenerator();

// Create Hono app
const app = new Hono();

// Middleware
app.use("*", cors());
app.use("*", logger());

// Health check
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: "0.1.0",
  });
});

// Verify endpoint
app.post("/verify", async (c) => {
  try {
    const body = await c.req.json<{ paymentPayload: PaymentPayload }>();

    if (!body.paymentPayload) {
      return c.json({ valid: false, reason: "missing_payment_payload" }, 400);
    }

    const result = await verifyModule.verifyPayment(body.paymentPayload);

    if (!result.valid) {
      return c.json(result, 402);
    }

    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "internal_error";
    return c.json({ valid: false, reason: `server_error: ${message}` }, 500);
  }
});

// Settle endpoint
app.post("/settle", async (c) => {
  try {
    const body = await c.req.json<{ paymentPayload: PaymentPayload }>();

    if (!body.paymentPayload) {
      return c.json({ success: false, error: "missing_payment_payload" }, 400);
    }

    // Verify first
    const verifyResult = await verifyModule.verifyPayment(body.paymentPayload);
    if (!verifyResult.valid) {
      return c.json(
        { success: false, error: `verification_failed: ${verifyResult.reason}` },
        402,
      );
    }

    // Settle
    const settleResult = await settleModule.settle(body.paymentPayload);

    if (!settleResult.success) {
      return c.json(settleResult, 500);
    }

    // Generate receipt header
    const paymentResponseHeader = receiptGenerator.generateHeader(settleResult);
    if (paymentResponseHeader) {
      c.header("X-PAYMENT-RESPONSE", paymentResponseHeader);
    }

    return c.json(settleResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : "internal_error";
    return c.json({ success: false, error: `server_error: ${message}` }, 500);
  }
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: "not_found" }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "internal_server_error" }, 500);
});

// Start server
const server = {
  port: PORT,
  fetch: app.fetch,
};

console.log(`Hydra facilitator starting on port ${PORT}`);
console.log(`  RPC URL: ${RPC_URL}`);
console.log(`  Settler: ${SETTLER_KEY ? "configured" : "not configured (verify-only mode)"}`);
console.log(`  Redis: ${REDIS_URL || "in-memory nonces"}`);

export default server;

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const { serve } = await import("@hono/node-server");
  serve(server, (info) => {
    console.log(`Hydra facilitator listening on http://localhost:${info.port}`);
  });
}
