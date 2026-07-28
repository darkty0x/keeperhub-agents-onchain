# Go live — real KeeperHub Sepolia execution

Judges score **real onchain execution through KeeperHub**, not mock hashes.
This repo ships a complete observe → decide → policy → execute → audit product
in mock mode so the demo UI works immediately. Flip to live with the steps
below.

## Prerequisites

1. KeeperHub account at [app.keeperhub.com](https://app.keeperhub.com)
2. Organization API key (`kh_…`) under **Settings → API Keys → Organisation**
3. Wallet integration configured and funded on **Sepolia** (gas for the action
   you will run)
4. Confirm Aave / transfer availability for your org, or prefer the allowlisted
   `transfer-topup` action for the smallest first live proof

## Local live run

```bash
cp .env.example .env
# set KEEPERHUB_API_KEY=kh_...
# set KEEPERHUB_MOCK=0   (or remove the variable)
# point CONFIG_PATH at config with your real wallet + allowlisted recipient

npm run cli -- mcp-probe
```

`mcp-probe` prints live `tools/list` schemas for:

- `execute_transfer`
- `execute_protocol_action`
- `execute_check_and_execute`
- `get_direct_execution_status`

Compare those schemas with `src/keeperhub/client.ts`. Update **only** the wire
argument mapping if field names differ. Keep `KeeperHubClient` stable.

Then:

```bash
unset KEEPERHUB_MOCK
npm run cli -- run
# or force a guardian-style decision via the API:
curl -s -X POST http://localhost:8787/api/guardian/run \
  -H 'Content-Type: application/json' \
  -d '{"forceBreach":true}'
```

Verify the returned `txHash` on
[Sepolia Etherscan](https://sepolia.etherscan.io). Paste that exact hash into
the README submission checklist. Do **not** invent a hash.

## Railway live run

On the `api` service:

| Variable | Value |
| --- | --- |
| `KEEPERHUB_API_KEY` | `kh_…` (secret) |
| `KEEPERHUB_MOCK` | delete or set `0` |
| `X402_DEMO_BYPASS` | keep `1` only for unpaid demo UX |
| `AUDIT_PATH` | `/tmp/audit.jsonl` (or a volume path) |

Redeploy API, open the web dashboard, confirm the badge flips to **LIVE
KeeperHub**, run **Guardian breach**, expand the audit row, open the explorer
link.

## Demo video

Follow [`demo-script.md`](./demo-script.md). Record with the **live** badge and
a real explorer link visible.

## Submission pack

- Public GitHub URL
- Demo video URL
- Real KeeperHub Sepolia tx hash + Etherscan link
- DoraHacks BUIDL form: [Agents Onchain](https://dorahacks.io/hackathon/agents-onchain)
