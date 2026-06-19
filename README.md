# hydra

x402 has one failure mode nobody talks about: the facilitator goes down, and all payments stop. Every agent using that facilitator is dead in the water.

Hydra solves this two ways. First, it's a self-hostable x402 facilitator you can run yourself instead of depending on someone else's infrastructure. Second, it ships a failover client that automatically routes around dead facilitators — yours, public ones, friends' instances, whatever you configure.

## Run your own facilitator

```bash
# Docker
docker run -p 8402:8402 \
  -e RPC_URL=https://mainnet.base.org \
  -e SETTLER_KEY=0xYOUR_PRIVATE_KEY \
  hydra:latest

# or from source
npm install && npm run build
PORT=8402 RPC_URL=https://mainnet.base.org SETTLER_KEY=0x... npm start
```

Implements the full x402 verify + settle flow for Base/USDC (EIP-3009) and Solana. Replay protection via nonce deduplication. Receipts via `X-PAYMENT-RESPONSE` header.

## Failover client

```typescript
import { FailoverClient } from "hydra/client";

const client = new FailoverClient({
  facilitators: [
    "http://localhost:8402",           // yours
    "https://backup.example.com",      // friend's
    "https://public-facilitator.x402.org",  // fallback
  ],
  healthcheckMs: 15_000,
  circuitBreakerDurationMs: 60_000,
  maxRetries: 3,
});

client.on("failover", ({ from, to, error }) => {
  console.log(`failover: ${from} → ${to}`);
});

const result = await client.settle(paymentPayload);
```

The router runs health checks on all configured facilitators and maintains a circuit breaker per endpoint. Failed facilitators get removed from rotation and retried after `circuitBreakerDurationMs`.

## API endpoints

`POST /verify` — validates signature, balance, nonce, expiry without settling.

`POST /settle` — settles on-chain and returns `{ txHash, blockNumber, proof }`.

`GET /health` — uptime + version check for load balancers and the failover client.

## Config

| Env var | Default | What it does |
|---|---|---|
| `PORT` | `8402` | Listen port |
| `RPC_URL` | `https://mainnet.base.org` | EVM RPC |
| `SETTLER_KEY` | required | Private key for settlement |
| `REDIS_URL` | — | Nonce persistence (optional, in-memory default) |

## What's not done yet

Redis-backed nonce store for production persistence. Batch settlement. Additional EVM chains (Optimism, Arbitrum). The core Base + Solana flows are implemented and tested.

## License

MIT
