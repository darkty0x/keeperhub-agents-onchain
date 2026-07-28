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

Currently running with `KEEPERHUB_MOCK=1` until a live `kh_` key is configured.

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
| `KEEPERHUB_API_KEY` | Default env name for the live KeeperHub key (`kh_...`); override via `keeperhubApiKeyEnv` in config |
| `KEEPERHUB_MOCK` | Set to `1` to force the local mock |
| `KEEPERHUB_MCP_URL` | Optional MCP endpoint override |
| `CONFIG_PATH` | JSON config path; defaults to `config/default.json` |
| `AUDIT_PATH` | JSONL audit path; defaults to `data/audit.jsonl` |
| `PORT` | API port; defaults to `8787` |
| `GUARDIAN_AUTOSTART` | Set to `1` to start guardian with the API |
| `X402_DEMO_BYPASS` | Local `demo` payment bypass only |
| `NEXT_PUBLIC_API_BASE` | Dashboard API URL; defaults to localhost:8787 |
| `NEXT_PUBLIC_WEB_ORIGIN` | Additional allowed browser origin |

## Aligning the live MCP tool arguments

Live KeeperHub execution was not performed because
`KEEPERHUB_API_KEY` is unavailable in this environment. Once a real `kh_` key
exists:

1. Create/sign into KeeperHub, create an organization API key, and fund the
   configured Sepolia wallet if required.
2. Query the authenticated MCP endpoint's `tools/list` (or
   `tools_documentation`) response. Confirm exact tool names and required
   arguments for `execute_protocol_action`, `execute_transfer`,
   `execute_check_and_execute`, and `get_direct_execution_status`.
3. Compare that schema with `HttpKeeperHubClient`: protocol action currently
   maps `actionType` and `amount`; transfer maps `to`, `amount`, and
   `tokenAddress`; fallback maps `amount`; status maps `executionId`.
4. Update only this wire mapping (keep `KeeperHubClient` stable), then run
   `npm run build` and tests before one small allowlisted Sepolia action.
5. Poll until a transaction hash is returned, verify it on Sepolia Etherscan,
   and record that exact hash below and in the video notes.

## Submission checklist

- [ ] Public GitHub repository link: `PLACEHOLDER`
- [ ] Approximately two-minute demo video link: `PLACEHOLDER`
- [ ] Real KeeperHub Sepolia transaction: `PLACEHOLDER` (replace with the
      exact `0x...` hash only after live execution)
- [ ] Etherscan link: `PLACEHOLDER`
- [x] Shared core with guardian, event, and paid API modes
- [x] Policy gate, kill switch, cooldown, allowlists, and audit trail
- [x] CLI and dashboard demo path
- [ ] Live `tools/list` argument alignment and one successful Sepolia action

## Verification

```bash
npm test
npm run build
```

The local mock path produces `0xMOCK…` placeholders only—not verifiable Sepolia
transactions. Live hashes appear only after a successful KeeperHub execution
with mock disabled and a valid API key.
