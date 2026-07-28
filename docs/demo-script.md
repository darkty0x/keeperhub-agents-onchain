# KeeperHub Agents Onchain — two-minute demo

Record against the deployed dashboard when possible:

- Web: https://web-production-a79e1.up.railway.app
- API: https://api-production-66a0.up.railway.app

For a local dry-run (mock hashes), start:

```bash
KEEPERHUB_MOCK=1 X402_DEMO_BYPASS=1 npm run server
cd apps/web && NEXT_PUBLIC_API_BASE=http://localhost:8787 npm run dev
```

Prefer a **live** recording for submission (`KEEPERHUB_MOCK` off + real `kh_`
key). See [`go-live.md`](./go-live.md).

## Timeline and narration

### 0:00–0:20 — Introduce the product

“KeeperHub Agents Onchain is one TypeScript agent with three triggers:
guardian monitoring, contract-event response, and a paid agent API. All three
use the same observe, decide, policy, execute, and audit pipeline.”

Point to **Submission readiness**, the MOCK/LIVE badge, MCP endpoint, and the
policy gate (kill switch, max amount, cooldown).

### 0:20–0:50 — Guardian path

Click **Run guardian breach**.

“The agent observes the wallet metric, rules pick an allowlisted Aave withdraw
buffer action, policy runs before KeeperHub, and the execution writes an audit
row with trigger, decision, policy, and transaction hash.”

Expand **Last cycle breakdown** and the new audit row.

### 0:50–1:10 — Event mode

Click **Ingest demo event**.

“An event becomes an observation and enters the exact same core; event mode
does not duplicate execution or policy logic.”

### 1:10–1:30 — Paid API boundary

Click **Call unpaid (expect 402)** — show the challenge JSON.

Then click **Pay demo + run**.

“Without payment, the endpoint returns 402 and does not run. The demo payment
header is local-only; production verification stays fail-closed until a real
x402 verifier is configured.”

### 1:30–1:50 — Live KeeperHub proof

If recording live: open the audit tx on Sepolia Etherscan.

If still on mock: say clearly that mock hashes are wiring-only, then cut to a
pre-captured live explorer tab for the submission hash from `docs/go-live.md`.

### 1:50–2:00 — Close

“Safety is the policy gate before every write, plus kill switch and
append-only audit. Submission is GitHub, this video, and a real Sepolia
transaction executed through KeeperHub.”

Do not claim a transaction exists until the live run returns and verifies an
actual hash on Sepolia Etherscan.
