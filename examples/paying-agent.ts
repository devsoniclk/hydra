/**
 * Example: Paying agent that uses x402 to access paid resources
 *
 * This demonstrates how an agent can:
 * 1. Discover a paid resource (receive 402)
 * 2. Create a payment payload
 * 3. Send payment with the request
 * 4. Handle the response
 */

import { FailoverClient } from "../client/failover.js";
import type { PaymentPayload } from "../facilitator/types.js";

const FACILITATORS = [
  process.env.FACILITATOR_URL ?? "http://localhost:8402",
  "https://facilitator.example.com",
];

/**
 * Create a mock payment payload
 * In production, this would be created by the wallet/agent
 * using the actual EIP-3009 signing flow.
 */
function createPaymentPayload(
  from: string,
  to: string,
  amount: string,
  nonce: string,
): PaymentPayload {
  const now = Math.floor(Date.now() / 1000);

  return {
    x402Version: 1,
    scheme: "exact",
    network: "base",
    payload: {
      signature: "0x" + "a".repeat(130), // Mock signature
      authorization: {
        from,
        to,
        value: amount,
        validAfter: String(now - 60),
        validBefore: String(now + 300), // 5 min window
        nonce: "0x" + nonce.padStart(64, "0"),
      },
    },
  };
}

async function main() {
  console.log("=== Hydra Paying Agent Example ===\n");

  // Initialize failover client
  const client = new FailoverClient({
    facilitators: FACILITATORS,
    healthcheckMs: 10_000,
    circuitBreakerDurationMs: 30_000,
    maxRetries: 2,
  });

  // Listen for failover events
  client.on("failover", ({ from, to, error }) => {
    console.log(`[FAILOVER] ${from} -> ${to}: ${error}`);
  });

  client.on("recovery", ({ facilitator }) => {
    console.log(`[RECOVERY] ${facilitator} is back online`);
  });

  // Create a payment
  const payment = createPaymentPayload(
    "0xPAYER_ADDRESS",
    "0xRECIPIENT_ADDRESS",
    "1000000", // 1 USDC
    "abc123",
  );

  console.log("Attempting payment...");

  try {
    // First, verify the payment
    const verifyResult = await client.verify(payment);
    console.log("Verify result:", verifyResult);

    if (verifyResult.valid) {
      // Settle the payment
      const settleResult = await client.settle(payment);
      console.log("Settle result:", settleResult);

      if (settleResult.success) {
        console.log(`\nPayment settled! TX: ${settleResult.txHash}`);

        // Now access the paid resource
        const paymentHeader = Buffer.from(JSON.stringify(payment)).toString("base64");

        const response = await fetch("http://localhost:3000/api/complete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-PAYMENT": paymentHeader,
          },
          body: JSON.stringify({ prompt: "Hello, world!" }),
        });

        const data = await response.json();
        console.log("\nResource response:", data);
      }
    }
  } catch (error) {
    console.error("Payment failed:", error);
  }

  // Cleanup
  client.destroy();
}

main().catch(console.error);
