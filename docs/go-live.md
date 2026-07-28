# Go live — real KeeperHub Sepolia execution

**Mock is not submission-ready.** DoraHacks requires a real KeeperHub transaction,
demo video, and public GitHub. This guide is the only path that counts for judging.

## Prerequisites

1. KeeperHub account at [app.keeperhub.com](https://app.keeperhub.com)
2. Organization API key (`kh_…`) under **Settings → API Keys → Organisation**
3. Wallet integration configured and **funded on Sepolia** (gas for a tiny transfer)
4. Two real addresses:
   - `WALLET_ADDRESS` — RPC watch target (can be the KeeperHub wallet)
   - `RECIPIENT_ADDRESS` — allowlisted transfer recipient (must differ if you want a visible transfer)

## Local live run

```bash
cp .env.example .env
cp config/live.example.json config/local.json
# edit config/local.json OR set env overrides:

export KEEPERHUB_API_KEY=kh_...
unset KEEPERHUB_MOCK
export REQUIRE_LIVE_KEEPERHUB=1
export WALLET_ADDRESS=0xYourWatch…
export RECIPIENT_ADDRESS=0xYourRecipient…
export CONFIG_PATH=config/local.json
export PREFER_TRANSFER_FIRST=1

npm run cli -- mcp-probe
npm run live-submit
```

`live-submit` probes MCP schemas, runs a guardian breach (prefers tiny `transfer-topup`),
prints the Sepolia hash, and updates the README checklist. Verify on Etherscan before
recording the video.

## Railway

On the `api` service:

| Variable | Value |
| --- | --- |
| `KEEPERHUB_API_KEY` | `kh_…` (secret) |
| `KEEPERHUB_MOCK` | **delete** |
| `REQUIRE_LIVE_KEEPERHUB` | `1` |
| `WALLET_ADDRESS` | real Sepolia address |
| `RECIPIENT_ADDRESS` | real allowlisted recipient |
| `PREFER_TRANSFER_FIRST` | `1` |
| `X402_DEMO_BYPASS` | `1` only for unpaid demo UX |
| `AUDIT_PATH` | `/tmp/audit.jsonl` or a volume |
| `SUBMISSION_TX_HASH` | set after first success (survives audit wipe) |

Redeploy API, open the web dashboard, confirm badge is **LIVE**, run **Guardian breach**,
open the explorer link, set `SUBMISSION_TX_HASH` to that hash.

While `KEEPERHUB_MOCK=1` remains on Railway production, write endpoints return **503**
(not submission-ready). Status still loads so the checklist can show the gap.

## Demo video

Follow [`demo-script.md`](./demo-script.md). Record **only** with LIVE badge + real
explorer link. Do not show mock hashes as proof.

## Submission pack

- Public GitHub URL
- Demo video URL
- Real KeeperHub Sepolia tx hash + Etherscan link
- DoraHacks BUIDL: [Agents Onchain](https://dorahacks.io/hackathon/agents-onchain)
