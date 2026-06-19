/**
 * Example: x402-accepting resource server
 *
 * This demonstrates how to use Hydra as a payment gate for an API.
 * When a request comes in without payment, it returns 402 with payment instructions.
 * When payment is provided, it verifies and settles via the facilitator.
 */

import { Hono } from "hono";
import type { PaymentPayload } from "../facilitator/types.js";

const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://localhost:8402";
const PORT = parseInt(process.env.PORT ?? "3000", 10);

const app = new Hono();

/**
 * Example paid resource: AI completion endpoint
 */
app.post("/api/complete", async (c) => {
  // Check for x402 payment header
  const paymentHeader = c.req.header("X-PAYMENT");

  if (!paymentHeader) {
    // Return 402 with payment required instructions
    return c.json(
      {
        x402Version: 1,
        paymentRequired: {
          scheme: "exact",
          network: "base",
          amount: "1000000", // 1 USDC (6 decimals)
          recipient: "0xYOUR_RECIPIENT_ADDRESS",
          description: "AI completion request",
        },
      },
      402,
    );
  }

  // Decode and verify the payment
  try {
    const paymentPayload: PaymentPayload = JSON.parse(
      Buffer.from(paymentHeader, "base64").toString("utf-8"),
    );

    // Verify with facilitator
    const verifyResponse = await fetch(`${FACILITATOR_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentPayload }),
    });

    const verifyResult = (await verifyResponse.json()) as { valid: boolean; reason?: string };

    if (!verifyResult.valid) {
      return c.json(
        {
          error: "payment_invalid",
          reason: verifyResult.reason,
        },
        402,
      );
    }

    // Settle the payment
    const settleResponse = await fetch(`${FACILITATOR_URL}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentPayload }),
    });

    const settleResult = (await settleResponse.json()) as {
      success: boolean;
      txHash?: string;
      proof?: object;
    };

    if (!settleResult.success) {
      return c.json({ error: "settlement_failed" }, 500);
    }

    // Return the resource with payment proof header
    const paymentResponseHeader = settleResponse.headers.get("X-PAYMENT-RESPONSE");
    if (paymentResponseHeader) {
      c.header("X-PAYMENT-RESPONSE", paymentResponseHeader);
    }

    // Generate the actual resource
    return c.json({
      completion: "This is a simulated AI completion response.",
      model: "hydra-demo-v1",
      usage: { tokens: 42 },
    });
  } catch (error) {
    console.error("Payment processing error:", error);
    return c.json({ error: "payment_processing_failed" }, 500);
  }
});

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

console.log(`Resource server starting on port ${PORT}`);
console.log(`  Facilitator: ${FACILITATOR_URL}`);

export default app;
