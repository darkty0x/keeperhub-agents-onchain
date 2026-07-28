# KeeperHub Agents Onchain — two-minute demo

Record against the **live** dashboard only:

- Web: https://keeperhub-agents.up.railway.app
- API: https://keeperhub-agents-api.up.railway.app

Confirm the header shows **Live** (not Mock) before you start.

Proof tx (keep this tab ready):  
https://sepolia.etherscan.io/tx/0xa1f45ff4f674958b51030f3b5ac30e7a2cd94aeb0167ab3aad207774241f41b3

## Before record

1. Hard-refresh the dashboard.
2. If the last guardian run was within ~60s, wait for cooldown or start with Event / Observe first.
3. Close unrelated tabs; zoom so wallet + tx hash stay readable.
4. Optional second screen: Etherscan tx page already open.

## Timeline and narration

### 0:00–0:25 — What it is

“KeeperHub Agents Onchain is one TypeScript agent with three triggers—guardian,
event, and a paid API—sharing one pipeline: observe, decide, policy, KeeperHub
execution, audit.”

Point to:

- **Live** + Sepolia
- **Watched wallet** (click + copy)
- **Latest transaction** (full hash, click through to Etherscan)

“The watched address is the RPC observe target. KeeperHub’s org wallet signs—
there is no MetaMask in this UI.”

### 0:25–0:55 — Guardian run + cycle steps

Select **Guardian** → **Run guardian**.

When the cycle fills in, click through:

1. **Observe** — balance / threshold  
2. **Decide** — action chosen  
3. **Policy** — allowed / limits  
4. **Execute** — outcome + transaction link  

“Same core every time. Policy gates the write. The hash is a real Sepolia
KeeperHub execution.”

Open the tx link briefly (or cut to the prepared Etherscan tab).

### 0:55–1:15 — Event mode

Select **Event** → **Ingest event**.

“Different trigger, same cycle.”

Show Decide → Execute quickly (skip long pauses).

### 1:15–1:35 — Paid API boundary

Select **x402** → show the gate panel (endpoint, `x-payment`, price, payTo, challenge JSON).

**Unpaid → 402** → run → show live HTTP 402 body.

**Paid header** → run → cycle completes with trigger `x402`.

“x402 gate before the same execution core.”

### 1:35–1:50 — Observe (optional)

Select **Observe** → run.

“Read-only path. If conditions are healthy, outcome can be noop—no fake tx.”

### 1:50–2:00 — Close

Scroll **History**. Point again at the live Sepolia hash.

“Submission: public GitHub, this demo, and that KeeperHub transaction.”

## Recording tips

- Prefer 1080p, mic close, no music.
- If a run is **blocked** by cooldown, narrate it honestly and click **Execute**
  on the previous success (or open the pinned Etherscan link).
- Do not show API keys, Railway env, or `.env` files on camera.
