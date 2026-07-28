# KeeperHub Agents Onchain — two-minute demo

This script demonstrates the local flow end to end, then explains the one
live-execution step that must be recorded with a real `kh_` key. Keep the
terminal and dashboard visible together.

## Before recording

Start the API in the repository root:

```bash
KEEPERHUB_MOCK=1 X402_DEMO_BYPASS=1 npm run server
```

Start the dashboard in a second terminal:

```bash
cd apps/web
NEXT_PUBLIC_API_BASE=http://localhost:8787 npm run dev
```

Open `http://localhost:3000`. The local mock is intentional for this
walkthrough; it does not produce a real transaction hash.

## Timeline and narration

### 0:00–0:20 — Introduce the product

“KeeperHub Agents Onchain is one TypeScript agent with three triggers:
guardian monitoring, contract-event response, and a paid agent API. All three
use the same observe, decide, policy, execute, and audit pipeline.”

Point to the dashboard status, configured Sepolia chain, and kill-switch
indicator.

### 0:20–0:50 — Run the guardian path

Click **Run now**. Say:

“The agent observes the configured wallet, applies the threshold rule, chooses
an allowlisted action, and shows the resulting decision. Policy runs before
KeeperHub, so amount limits, recipient allowlists, cooldown, chain allowlists,
and the kill switch are enforced centrally.”

Point to the new audit row and its trigger, decision, policy, and outcome.

### 0:50–1:10 — Show event mode

Run:

```bash
curl -s -X POST http://localhost:8787/api/events/ingest \
  -H 'Content-Type: application/json' \
  -d '{"name":"Transfer","txHash":"0xdemo","payload":{"amount":"1"}}'
```

Refresh the dashboard. Say:

“An event becomes an observation and enters the exact same core; event mode
does not duplicate execution or policy logic.”

### 1:10–1:30 — Show the paid API boundary

First show the unpaid challenge:

```bash
curl -i -s -X POST http://localhost:8787/api/paid/run
```

Then show the local demo payment:

```bash
curl -s -X POST http://localhost:8787/api/paid/run \
  -H 'x-payment: demo' -H 'Content-Type: application/json'
```

Say:

“Without payment, the endpoint returns 402 and does not run. The `demo`
header is a local bypass for this recording only; production verification is
fail-closed until a real x402 verifier is configured.”

### 1:30–1:50 — Explain live KeeperHub execution

“For a live submission, the mock is removed and `KEEPERHUB_API_KEY` is set to
the organization’s real `kh_` key. The client calls the authenticated MCP
tools, polls the execution status, and writes the returned transaction hash
to the audit record and dashboard.”

Show the relevant README checklist with the transaction hash still marked
`PLACEHOLDER` if live execution has not yet been completed.

### 1:50–2:00 — Close with safety and submission

“The important safety boundary is the policy gate before every write, plus
the kill switch and append-only audit trail. The final submission includes the
repository, this video, and a real Sepolia transaction executed through
KeeperHub.”

Do not claim a transaction exists until the live run returns and verifies an
actual hash on Sepolia Etherscan.
