# Security Policy

## Supported versions

The latest `1.x` release receives security fixes.

## Reporting a vulnerability

Please report security issues privately via GitHub Security Advisories
("Report a vulnerability" on the repository's Security tab) or by email to
security@novacortex.dev. Do not open a public issue for vulnerabilities. We aim to
acknowledge within 72 hours.

## Secure self-hosting

- **Generate secrets** with `./scripts/gen-env.sh` — never use placeholder values.
  The supported self-host compose (`docker-compose.unraid.yml`) **fails to start** if
  required secrets (`SURREALDB_PASS`, `REDIS_PASSWORD`, …) are missing.
- **Auth is locked down by default**: every data route requires a token (random,
  SHA-256–hashed; never stored in cleartext). The first admin token is minted from a
  one-time, 1-hour bootstrap code printed in the API logs on first start.
- **Network**: the databases run on an internal Docker network and are not exposed.
  Only the Web UI (3000) and API (3001) are published. Put them behind a TLS reverse
  proxy for internet exposure and set `CORS_ORIGINS` to your UI origin(s).
- **Embeddings/privacy**: semantic search is off until `OPENAI_API_KEY` is set, which
  sends memory text to OpenAI. For fully-local operation set `OPENAI_BASE_URL` to an
  OpenAI-compatible local server.
- **Never commit** `.env` or `.memory-stack-license` (both are gitignored).

## Known hardening follow-ups (tracked)

- Default application-level rate limiting on the data plane (currently on auth/admin
  routes; rely on a reverse proxy for the rest).
- Asymmetric (ed25519) license signing to replace the HMAC scheme.
