# Hydra

> x402 has one fatal dependency: the facilitator. If it goes down, payments stop.
> Hydra lets you run your own — and fail over to others.

## What is this?

Hydra is a **self-hostable x402 facilitator** with built-in **multi-facilitator failover**. It implements the [x402 payment protocol](https://x402.org) verify and settle flow for Base/USDC (EVM) and Solana, and provides a failover client that automatically routes around dead facilitators.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Paying Client / Agent                       │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    FailoverRouter                              │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │  │
│  │  │ Hydra #1 │  │ Hydra #2 │  │ Public   │  │ Hydra #N │     │  │
│  │  │ (yours)  │  │ (friend) │  │ facilit. │  │ (backup) │     │  │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘     │  │
│  │       │              │              │              │           │  │
│  │       └──── health checks + circuit breaker ──────┘           │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                               │
                    POST /verify, POST /settle
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Hydra Facilitator Server                       │
│                                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────────────┐  │
│  │   /verify    │──▶│   Verify     │──▶│  ReplayGuard           │  │
│  │              │   │  (sig+bal+   │   │  (nonce/expiry/memory) │  │
│  └──────────────┘   │   nonce)     │   └────────────────────────┘  │
│                      └──────────────┘                               │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────────────┐  │
│  │   /settle    │──▶│   Settle     │──▶│  Base (EIP-3009)       │  │
│  │              │   │              │──▶│  Solana                 │  │
│  └──────────────┘   └──────────────┘   └────────────────────────┘  │
│                                              │                      │
│                                     ┌────────▼────────┐            │
│                                     │  Receipt / Proof │            │
│                                     └─────────────────┘            │
└─────────────────────────────────────────────────────────────────────┘
                               │
                     On-chain settlement
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
              ┌──────────┐         ┌──────────┐
              │  Base    │         │  Solana  │
              │  (USDC)  │         │  (USDC)  │
              └──────────┘         └──────────┘
```

## Quickstart

### Docker (one command)

```bash
docker run -p 8402:8402 \
  -e RPC_URL=https://mainnet.base.org \
  -e SETTLER_KEY=0xYOUR_PRIVATE_KEY \
  hydra:latest
```

### Docker Compose

```bash
# .env
RPC_URL=https://mainnet.base.org
SETTLER_KEY=0xYOUR_PRIVATE_KEY

docker compose up -d
```

### From source

```bash
npm install
npm run build
PORT=8402 RPC_URL=https://mainnet.base.org SETTLER_KEY=0x... npm start
```

## API

### `POST /verify`

Validates a payment payload without settling.

```json
// Request
{ "paymentPayload": { "x402Version": 1, "scheme": "exact", "network": "base", ... } }

// Response
{ "valid": true }
// or
{ "valid": false, "reason": "insufficient_balance" }
```

### `POST /settle`

Settles a payment on-chain and returns a proof.

```json
// Response
{
  "success": true,
  "txHash": "0xabc...",
  "blockNumber": 12345n,
  "proof": { "transaction": "0xabc...", "network": "base", "payer": "0x..." }
}
```

### `GET /health`

```json
{ "status": "ok", "uptime": 3600, "version": "0.1.0" }
```

## Failover Client

The failover client wraps multiple facilitator endpoints and automatically routes around failures.

```typescript
import { FailoverClient } from "hydra/client";

const client = new FailoverClient({
  facilitators: [
    "http://localhost:8402",
    "https://facilitator.example.com",
    "https://public-facilitator.x402.org",
  ],
  healthcheckMs: 15_000,
  circuitBreakerDurationMs: 60_000,
  maxRetries: 3,
});

// Events
client.on("failover", ({ from, to, error }) => {
  console.log(`Failed over from ${from} to ${to}: ${error}`);
});

client.on("recovery", ({ facilitator }) => {
  console.log(`Recovered: ${facilitator}`);
});

// Use it
const result = await client.settle(paymentPayload);
console.log(result.txHash);

// Check health
const healthy = client.getHealthyFacilitators();
console.log("Healthy:", healthy);
```

## Configuration

| Env Var       | Default                  | Description                          |
|---------------|--------------------------|--------------------------------------|
| `PORT`        | `8402`                   | Server listen port                   |
| `RPC_URL`     | `https://mainnet.base.org` | EVM RPC endpoint                   |
| `SETTLER_KEY` | —                        | Private key for on-chain settlement  |
| `REDIS_URL`   | —                        | Optional Redis for nonce persistence |
| `LOG_LEVEL`   | `info`                   | Log level (debug/info/warn/error)    |

## Spec Compliance

Hydra implements the x402 protocol specification:

- **Verify**: Signature validation, balance checks, nonce tracking, expiry enforcement
- **Settle**: EIP-3009 `transferWithAuthorization` for EVM, SPL Token transfer for Solana
- **Receipts**: `X-PAYMENT-RESPONSE` header proof generation
- **Replay protection**: Nonce deduplication with configurable TTL

Currently supports:
- Base mainnet (EVM/USDC via EIP-3009)
- Solana mainnet (USDC via SPL Token)
- EIP-3009 and Permit2 schemes

## Roadmap

- [ ] Redis-backed nonce store (production-ready persistence)
- [ ] Batch settlement for fee efficiency
- [ ] Additional EVM chains (Optimism, Arbitrum, Polygon)
- [ ] Prometheus metrics endpoint
- [ ] Rate limiting and auth middleware
- [ ] WebSocket event stream for settlement confirmations
- [ ] Payment channel support
- [ ] Multi-token support (beyond USDC)

## Security

See [SECURITY.md](SECURITY.md) for our security policy and how to report vulnerabilities.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT — see [LICENSE](LICENSE).
