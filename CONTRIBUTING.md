# Contributing to Hydra

Thanks for your interest in contributing to Hydra!

## Getting Started

```bash
git clone https://github.com/your-org/hydra.git
cd hydra
npm install
npm test
```

## Development

```bash
# Run tests in watch mode
npm run test:watch

# Type-check
npm run lint

# Start dev server with hot reload
npm run dev
```

## Project Structure

```
facilitator/        # Server-side: verify, settle, receipts
client/             # Failover router client
examples/           # Example integrations
test/               # Test suite
```

## Pull Requests

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass (`npm test`)
6. Ensure types check (`npm run lint`)
7. Submit a PR with a clear description

## Code Style

- TypeScript with strict mode
- Prefer `const` over `let`
- Use async/await over raw promises
- Keep functions small and focused
- Document public APIs with JSDoc

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add Polygon chain support
fix: handle edge case in nonce validation
docs: update README quickstart
test: add replay guard edge case tests
```

## Testing

- Unit tests in `test/*.test.ts` using vitest
- Use fixtures in `test/fixtures/` for test data
- Mock external dependencies (RPC calls, chain interactions)
- Aim for high coverage on verify and settle logic

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
