# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Hydra, please report it responsibly.

**DO NOT** open a public GitHub issue for security vulnerabilities.

Instead, please email security concerns to: **security@hydra.dev** (placeholder — replace with your actual contact)

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response timeline

- **Acknowledgment**: within 48 hours
- **Initial assessment**: within 1 week
- **Fix or mitigation**: within 2 weeks for critical issues

## Security Considerations

### Private Key Management

The `SETTLER_KEY` environment variable contains a private key with on-chain authority. **Never** commit it to version control. Use:
- Environment variables in production
- Secret managers (AWS Secrets Manager, HashiCorp Vault, etc.)
- Docker secrets for containerized deployments

### Replay Protection

Hydra implements nonce-based replay protection. The in-memory store is suitable for single-instance deployments. For multi-instance deployments, use the Redis adapter (`REDIS_URL`) to share nonce state across instances.

### Network Trust

The facilitator submits transactions on behalf of payers. Ensure:
- The RPC endpoint (`RPC_URL`) is trusted and reliable
- TLS is used for all facilitator ↔ client communication
- The settlement private key has minimal on-chain permissions

## Scope

In scope:
- Facilitator server (verify, settle, receipts)
- Failover client
- Replay guard
- Docker configuration

Out of scope:
- Third-party RPC providers
- Underlying blockchain protocol vulnerabilities
- Client application integration bugs
