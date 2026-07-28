# KeeperHub Agents Onchain — two-minute demo

**Record only against LIVE KeeperHub** (not mock). Deployed URLs after go-live:

- Web: https://web-production-a79e1.up.railway.app
- API: https://api-production-66a0.up.railway.app

If the badge still says NOT SUBMISSION READY, stop and finish [`go-live.md`](./go-live.md).

## Timeline and narration

### 0:00–0:20 — Product + honesty

“KeeperHub Agents Onchain is one TypeScript agent with three triggers: guardian,
event response, and a paid x402 API. Observe → decide → policy → KeeperHub MCP →
audit. The watched address is an RPC observe target; the **KeeperHub org wallet**
signs transactions — there is no MetaMask connect in this UI.”

Point to LIVE badge, watched address, execution signer, submission tx link.

### 0:20–0:50 — Guardian live write

Click **Run guardian breach**.

“Rules prefer a tiny allowlisted transfer for the first Sepolia proof. Policy runs
before KeeperHub. The audit row shows a real hash — open Sepolia Etherscan.”

### 0:50–1:10 — Event mode

Click **Ingest demo event**. Same core, different trigger.

### 1:10–1:30 — x402 boundary

**Call unpaid** → 402. **Pay demo + run** → same core after local demo payment header
(not production payment verification).

### 1:30–1:50 — Manual noop (optional)

Click **Manual observe (often noop)**. Explain: healthy metrics → noop → no tx. That
is correct behavior, not a missing wallet.

### 1:50–2:00 — Close

“Submission is GitHub, this video, and this exact Sepolia transaction executed through
KeeperHub.”
