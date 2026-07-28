# KeeperHub Agents Onchain

One TypeScript agent with three entry modes—guardian, event responder, and
paid HTTP API—sharing the same observe → decide → policy → execute → audit
pipeline. KeeperHub is the intended onchain execution layer; Sepolia is the
default network.

## What it does

- Observes a wallet balance or an injected contract event.
- Chooses an allowlisted protocol action, transfer, or no-op (rules first;
  optional LLM selection is supported).
- Enforces chain, amount, recipient, cooldown, and kill-switch policy before
  any write.
- Calls KeeperHub MCP, polls the execution, and stores an append-only JSONL
  audit record with execution and transaction identifiers.

The thin Next.js dashboard in `apps/web` shows status, Run now, audit records,
Sepolia links for real hashes, and a mock label when `KEEPERHUB_MOCK=1` or the
hash contains `MOCK`.

## Deployed (Railway)

- **API:** https://api-production-66a0.up.railway.app
- **Web:** https://web-production-a79e1.up.railway.app
- Project: https://railway.com/project/3e08936e-8114-47f7-8a6d-4df8dd19c4bb

**Mock is NOT submission-ready.** DoraHacks requires a real KeeperHub transaction.
The Railway deploy is still on `KEEPERHUB_MOCK=1` until a live `kh_` key is set —
do not submit the BUIDL in that state. Go-live: [`docs/go-live.md`](docs/go-live.md).
Demo narration: [`docs/demo-script.md`](docs/demo-script.md).

## Architecture

```text
CLI / dashboard ─┐
guardian loop   ─┼─> observe -> decide -> policy -> KeeperHub MCP -> audit/UI
event ingest    ─┤
x402 endpoint   ─┘
```

`src/agent/core.ts` is the shared monolith. `src/modes/` supplies the three
triggers, `src/keeperhub/client.ts` contains the MCP adapter, and
`src/keeperhub/mock.ts` makes local demos deterministic.

## Setup

Requirements: Node.js 22+, npm, and (for live execution) a KeeperHub account,
an organization API key beginning with `kh_`, and a funded Sepolia wallet as
required by the KeeperHub account.

```bash
npm install
npm run build
cp config/default.json config/local.json   # edit addresses and limits
CONFIG_PATH=config/local.json KEEPERHUB_MOCK=1 npm run cli -- run
```

With `KEEPERHUB_MOCK=1`, the mock client returns hashes prefixed with
`0xMOCK…`; they are not on Sepolia and the dashboard shows “mock (not on
explorer)”. For live execution, export a real key (name from
`keeperhubApiKeyEnv` in config, default `KEEPERHUB_API_KEY`) and keep the mock
disabled:

```bash
export CONFIG_PATH=config/local.json
export KEEPERHUB_API_KEY=kh_...
unset KEEPERHUB_MOCK
npm run cli -- run
```

Do not commit `.env`, API keys, wallet secrets, or fabricated transaction
hashes.

## The three modes

1. Guardian: `npm run cli -- watch` runs the configured threshold check on an
   interval. `GUARDIAN_AUTOSTART=1 npm run server` starts it with the API.
2. Event responder: POST an event to `/api/events/ingest`; it is converted to
   an observation and sent through the same core.
3. Paid agent API: `POST /api/paid/run` returns an x402-style `402` challenge
   unless a valid payment verifier is wired. `X402_DEMO_BYPASS=1` with
   `x-payment: demo` is local-only and is not payment verification.

Useful CLI commands:

```bash
npm run cli -- run
npm run cli -- status
npm run cli -- replay
npm run cli -- watch
```

## API and dashboard demo

Start the API:

```bash
KEEPERHUB_MOCK=1 X402_DEMO_BYPASS=1 npm run server
```

In another terminal:

```bash
curl -s localhost:8787/api/health
curl -s -X POST localhost:8787/api/run
curl -s -X POST localhost:8787/api/events/ingest \
  -H 'Content-Type: application/json' \
  -d '{"name":"Transfer","txHash":"0xdemo","payload":{"amount":"1"}}'
curl -i -s -X POST localhost:8787/api/paid/run
curl -s -X POST localhost:8787/api/paid/run \
  -H 'x-payment: demo' -H 'Content-Type: application/json'
```

The full approximately two-minute recording script is in
[`docs/demo-script.md`](docs/demo-script.md). To run the web UI:

```bash
cd apps/web && npm install && NEXT_PUBLIC_API_BASE=http://localhost:8787 npm run dev
```

Open `http://localhost:3000`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `REQUIRE_LIVE_KEEPERHUB` | Set `1` to refuse mock boot and placeholder addresses |
| `WALLET_ADDRESS` | Override watched RPC address (must be real when live) |
| `RECIPIENT_ADDRESS` | Override transfer allowlist + transfer action recipient |
| `PREFER_TRANSFER_FIRST` | `1` prefers tiny transfer for first live proof |
| `SUBMISSION_TX_HASH` | Persist a verified live hash across audit wipes |
| `KEEPERHUB_API_KEY` | Default env name for the live KeeperHub key (`kh_...`); override via `keeperhubApiKeyEnv` in config |
| `KEEPERHUB_MOCK` | Set to `1` for **local tests only** — never for submission |
| `KEEPERHUB_MCP_URL` | Optional MCP endpoint override |
| `CONFIG_PATH` | JSON config path; defaults to `config/default.json` |
| `AUDIT_PATH` | JSONL audit path; defaults to `data/audit.jsonl` |
| `PORT` | API port; defaults to `8787` |
| `GUARDIAN_AUTOSTART` | Set to `1` to start guardian with the API |
| `X402_DEMO_BYPASS` | Local `demo` payment bypass only |
| `NEXT_PUBLIC_API_BASE` | Dashboard API URL; defaults to localhost:8787 |
| `NEXT_PUBLIC_WEB_ORIGIN` | Additional allowed browser origin |

## Aligning the live MCP tool arguments

Follow [`docs/go-live.md`](docs/go-live.md). Short version:

```bash
export KEEPERHUB_API_KEY=kh_...
unset KEEPERHUB_MOCK
npm run cli -- mcp-probe
```

Compare the printed schemas with `HttpKeeperHubClient`. Protocol actions send
`network`, `actionType`, and `amount`; transfers send `network`, `amount`,
`to` / `recipientAddress` (and optional `tokenAddress`); status sends
`executionId`. Update only the wire mapping, keep `KeeperHubClient` stable,
then run one small allowlisted Sepolia action and record the hash below.

## Submission checklist

- [ ] Public GitHub repository link: `PLACEHOLDER`
- [ ] Approximately two-minute demo video link: `PLACEHOLDER`
- [x] Real KeeperHub Sepolia transaction: `0xa1f45ff4f674958b51030f3b5ac30e7a2cd94aeb0167ab3aad207774241f41b3`
      exact `0x...` hash only after live execution)
- [x] Etherscan link: https://sepolia.etherscan.io/tx/0xa1f45ff4f674958b51030f3b5ac30e7a2cd94aeb0167ab3aad207774241f41b3
- [x] Shared core with guardian, event, and paid API modes
- [x] Policy gate, kill switch, cooldown, allowlists, and audit trail
- [x] CLI and dashboard demo path (all modes + cycle breakdown)
- [ ] Live `mcp-probe` argument alignment and one successful Sepolia action

## Verification

```bash
npm test
npm run build
```

The local mock path produces `0xMOCK…` placeholders only—not verifiable Sepolia
transactions. Live hashes appear only after a successful KeeperHub execution
with mock disabled and a valid API key.
