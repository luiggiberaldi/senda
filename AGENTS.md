<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Binance (saldo vía API, 2026-09-30)
- Script `scripts/binance-saldo.mjs`: consulta spot vía `GET /api/v3/account` firmada (HMAC-SHA256). Lee `BINANCE_API_KEY`/`BINANCE_API_SECRET` del entorno o de `../.env.local` (gitignored, guardadas 2026-09-30, **orden sin verificar**: se asumió 1er valor = secret, 2do = key según "la de arriba es la secret").
- **BLOQUEO**: `api.binance.com` (incluso `/api/v3/ping` sin firma) responde "restricted location" desde el egress del sandbox (IP de jurisdicción bloqueada). No se puede consultar el saldo desde aquí; no evadir el geo-bloqueo (ToS de Binance). El script sirve desde redes permitidas (p. ej. el teléfono/PC de luigi).
- La bóveda de credenciales (`credentials.request_api_access`) **declina** Binance: usa `signed_request` (firma HMAC), esquema no soportado. Por eso las claves van en `.env.local`, no en el vault.
